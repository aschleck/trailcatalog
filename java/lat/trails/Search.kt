package lat.trails

import com.google.common.geometry.S2Cap
import com.google.common.geometry.S2CellId
import com.google.common.geometry.S2LatLng
import com.google.common.geometry.S2LatLngRect
import com.google.common.geometry.S2Polygon
import com.google.common.geometry.S2RegionCoverer
import java.io.ByteArrayInputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.sql.Connection
import kotlin.math.ln
import lat.trails.proto.SearchRequest
import lat.trails.proto.SearchResponse
import lat.trails.proto.SearchResult
import lat.trails.proto.SearchResultKind
import org.trailcatalog.s2.earthMeters
import org.trailcatalog.s2.earthMetersToAngle

private const val RESULT_LIMIT = 10

// Each kind contributes this many by name alone before distance reorders them, so a near match
// that names alone rank low can still surface.
private const val CANDIDATE_LIMIT = 30

// Points are the one kind where thousands share a name, like 20,135 7-Elevens, so a second query
// only looks within this many map radii of the center.
private const val NEAR_RADII = 4.0

// Name scores run from 0 for a whole word match to the cutoff of 0.8, and a result 10 radii away
// pays ln(11) * 0.03 = 0.07 against one at the center. A whole word match on another continent at
// city zoom pays about ln(1000) * 0.03 = 0.21, so it still beats a weak match nearby.
private const val DISTANCE_WEIGHT = 0.03

// A place linked to Wikidata or Wikipedia ties with one that isn't from ln(1 + x) * 0.03 = 0.05,
// so x = 4.3 radii farther away.
private const val NOTABLE_BONUS = 0.05

// Below this the map is so zoomed in that every result is far, and only the name should matter.
private const val MIN_RADIUS_METERS = 1000.0

// See trailcatalog's Frontend.kt#BOUNDARY_AREA_BONUS.
private const val BOUNDARY_AREA_BONUS = "0.005 * GREATEST(LOG(GREATEST(b.area_meters2, 1)) - 6, 0)"

// Of the boundaries around a result, how many to name
private const val WITHIN_LIMIT = 3

private class Candidate(
    val result: SearchResult.Builder,
    val center: S2LatLng,
    val score: Double,
)

fun search(request: SearchRequest, connection: Connection, epoch: Int): SearchResponse {
  val query = request.query.replace(Regex("[%_\\\\]"), "").trim()
  if (query.isEmpty()) {
    return SearchResponse.getDefaultInstance()
  }

  val center = S2LatLng.fromDegrees(request.centerLatDegrees, request.centerLngDegrees)
  val radiusMeters = request.radiusMeters.coerceAtLeast(MIN_RADIUS_METERS)
  val candidates = ArrayList<Candidate>()
  candidates.addAll(searchBoundaries(query, connection, epoch))
  candidates.addAll(searchTrails(query, connection, epoch))
  candidates.addAll(searchPoints(query, null, connection, epoch))
  candidates.addAll(searchPoints(query, nearRanges(center, radiusMeters), connection, epoch))

  val ranked =
      candidates
          .distinctBy { it.result.kind to it.result.id }
          .sortedBy {
            val distance = center.getDistance(it.center).earthMeters()
            it.score + DISTANCE_WEIGHT * ln(1 + distance / radiusMeters)
          }
          .take(RESULT_LIMIT)
  fillBoundaryBounds(ranked, connection, epoch)
  fillWithin(ranked, connection, epoch)
  return SearchResponse.newBuilder().addAllResults(ranked.map { it.result.build() }).build()
}

// Scores group twice. MAX over the two branches for one name, because a whole word match drives
// strict_word_similarity to 1 and the branch to 0, which would throw away the substring branch's
// preference for the shorter of two names that both contain the query. Then DISTINCT ON keeps an
// entity's best name, which is also the one we report it matched.
// See also trailcatalog's Frontend.kt#executeSearchBoundaries.
//
// pg_trgm is installed in public, which the reshape schema we read through doesn't search.
private fun bestNames(table: String, cutoff: Double): String {
  return """
      SELECT DISTINCT ON (id) id, name, score
      FROM (
        SELECT id, name, MAX(score) AS score
        FROM (
          SELECT id, name, length(name) / 1000. AS score
          FROM $table
          WHERE name ILIKE '%' || ? || '%' AND epoch = ?
          UNION ALL
          SELECT id, name, 1 - public.strict_word_similarity(?, name) AS score
          FROM $table
          WHERE ? OPERATOR(public.<<%) name AND epoch = ?
        ) n
        WHERE n.score < $cutoff
        GROUP BY 1, 2
      ) m
      ORDER BY id, score
  """
}

// Sets the parameters bestNames reads, starting at index 1, and returns the next free index.
private fun java.sql.PreparedStatement.bindBestNames(query: String, epoch: Int): Int {
  setString(1, query)
  setInt(2, epoch)
  setString(3, query)
  setString(4, query)
  setInt(5, epoch)
  return 6
}

private fun searchBoundaries(query: String, connection: Connection, epoch: Int): List<Candidate> {
  connection.createStatement().executeUpdate("SET pg_trgm.strict_word_similarity_threshold TO 0.2")
  val candidates = ArrayList<Candidate>()
  connection
      .prepareStatement(
          """
          SELECT b.id, b.name, b.type, b.cell, nm.name, nm.score - $BOUNDARY_AREA_BONUS
          FROM (${bestNames("boundary_names", 0.8)}) nm
          JOIN boundaries b ON b.id = nm.id AND b.epoch = ?
          ORDER BY 6
          LIMIT ?
          """)
      .apply {
        val next = bindBestNames(query, epoch)
        setInt(next, epoch)
        setInt(next + 1, CANDIDATE_LIMIT)
      }
      .executeQuery()
      .use {
        while (it.next()) {
          val cell = S2CellId(it.getLong(4))
          val result =
              SearchResult.newBuilder()
                  .setKind(SearchResultKind.SEARCH_RESULT_KIND_BOUNDARY)
                  .setId(it.getLong(1))
                  .setName(it.getString(2))
                  .setType(it.getInt(3))
                  .setMatchedName(matchedName(query, it.getString(2), it.getString(5)))
          candidates.add(Candidate(result, cell.toLatLng(), it.getDouble(6)))
        }
      }
  return candidates
}

private fun searchTrails(query: String, connection: Connection, epoch: Int): List<Candidate> {
  connection.createStatement().executeUpdate("SET pg_trgm.strict_word_similarity_threshold TO 0.3")
  val candidates = ArrayList<Candidate>()
  connection
      .prepareStatement(
          """
          SELECT t.id, t.name, t.type, t.bound_degrees_e7, t.marker_degrees_e7, nm.name, nm.score
          FROM (${bestNames("trail_names", 0.7)}) nm
          JOIN trails t ON t.id = nm.id AND t.epoch = ?
          ORDER BY 7
          LIMIT ?
          """)
      .apply {
        val next = bindBestNames(query, epoch)
        setInt(next, epoch)
        setInt(next + 1, CANDIDATE_LIMIT)
      }
      .executeQuery()
      .use {
        while (it.next()) {
          // low lat, low lng, high lat, high lng
          val bound = ByteBuffer.wrap(it.getBytes(4)).order(ByteOrder.LITTLE_ENDIAN).asIntBuffer()
          val result =
              SearchResult.newBuilder()
                  .setKind(SearchResultKind.SEARCH_RESULT_KIND_TRAIL)
                  .setId(it.getLong(1))
                  .setName(it.getString(2))
                  .setType(it.getInt(3))
                  .setMatchedName(matchedName(query, it.getString(2), it.getString(6)))
                  .setLowLatDegrees(bound.get(0) / 1e7)
                  .setLowLngDegrees(bound.get(1) / 1e7)
                  .setHighLatDegrees(bound.get(2) / 1e7)
                  .setHighLngDegrees(bound.get(3) / 1e7)
          candidates.add(Candidate(result, markerOf(it.getBytes(5)), it.getDouble(7)))
        }
      }
  return candidates
}

/** Searches every point, or only those whose cells fall in [ranges] when it's set. */
private fun searchPoints(
    query: String,
    ranges: List<Pair<Long, Long>>?,
    connection: Connection,
    epoch: Int): List<Candidate> {
  connection.createStatement().executeUpdate("SET pg_trgm.strict_word_similarity_threshold TO 0.3")
  val near =
      ranges?.joinToString(" OR ", prefix = "AND (", postfix = ")") { "p.cell BETWEEN ? AND ?" }
  val candidates = ArrayList<Candidate>()
  connection
      .prepareStatement(
          """
          SELECT
            p.id,
            p.name,
            p.type,
            p.marker_degrees_e7,
            nm.name,
            nm.score - CASE WHEN p.notable THEN $NOTABLE_BONUS ELSE 0 END
          FROM (${bestNames("point_names", 0.7)}) nm
          JOIN points p ON p.id = nm.id AND p.epoch = ?
          WHERE true ${near ?: ""}
          ORDER BY 6
          LIMIT ?
          """)
      .apply {
        var next = bindBestNames(query, epoch)
        setInt(next++, epoch)
        for ((low, high) in ranges ?: listOf()) {
          setLong(next++, low)
          setLong(next++, high)
        }
        setInt(next, CANDIDATE_LIMIT)
      }
      .executeQuery()
      .use {
        while (it.next()) {
          val marker = markerOf(it.getBytes(4))
          // The display name is the bare name tag, which a point can lack while it has others.
          val name = it.getString(2) ?: it.getString(5)
          val result =
              SearchResult.newBuilder()
                  .setKind(SearchResultKind.SEARCH_RESULT_KIND_POINT)
                  .setId(it.getLong(1))
                  .setName(name)
                  .setType(it.getInt(3))
                  .setMatchedName(matchedName(query, name, it.getString(5)))
                  .setLowLatDegrees(marker.latDegrees())
                  .setLowLngDegrees(marker.lngDegrees())
                  .setHighLatDegrees(marker.latDegrees())
                  .setHighLngDegrees(marker.lngDegrees())
          candidates.add(Candidate(result, marker, it.getDouble(6)))
        }
      }
  return candidates
}

// Cell id ranges covering NEAR_RADII map radii around the center. Point cells are leaves of
// these, so a range test finds them through the cell index.
private fun nearRanges(center: S2LatLng, radiusMeters: Double): List<Pair<Long, Long>> {
  val cap =
      S2Cap.fromAxisAngle(center.toPoint(), earthMetersToAngle(NEAR_RADII * radiusMeters))
  val covering = S2RegionCoverer.builder().setMaxCells(8).build().getCovering(cap)
  return covering.cellIds().map { it.rangeMin().id() to it.rangeMax().id() }
}

private fun markerOf(bytes: ByteArray): S2LatLng {
  // lat then lng
  val ints = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN).asIntBuffer()
  return S2LatLng.fromE7(ints.get(0), ints.get(1))
}

// A shorter translation can outscore the display name on length alone, but showing it then only
// confuses, so a display name that contains the query wins.
private fun matchedName(query: String, name: String, matched: String): String {
  return if (matched == name || name.contains(query, ignoreCase = true)) "" else matched
}

// Boundaries rank by their cell's center, but a cell can be several times the size of the
// boundary inside it, so the camera gets the polygon's own bound. Only the results pay to decode
// a polygon, which for a country is megabytes.
private fun fillBoundaryBounds(ranked: List<Candidate>, connection: Connection, epoch: Int) {
  val byId =
      ranked
          .filter { it.result.kind == SearchResultKind.SEARCH_RESULT_KIND_BOUNDARY }
          .associateBy { it.result.id }
  if (byId.isEmpty()) {
    return
  }

  connection
      .prepareStatement("SELECT id, s2_polygon FROM boundaries WHERE id = ANY(?) AND epoch = ?")
      .apply {
        setArray(1, connection.createArrayOf("BIGINT", byId.keys.toTypedArray()))
        setInt(2, epoch)
      }
      .executeQuery()
      .use {
        while (it.next()) {
          val result = byId[it.getLong(1)]?.result ?: continue
          val bound: S2LatLngRect =
              S2Polygon.decode(ByteArrayInputStream(it.getBytes(2))).rectBound
          result
              .setLowLatDegrees(bound.latLo().degrees())
              .setLowLngDegrees(bound.lngLo().degrees())
              .setHighLatDegrees(bound.latHi().degrees())
              .setHighLngDegrees(bound.lngHi().degrees())
        }
      }
}

private fun fillWithin(ranked: List<Candidate>, connection: Connection, epoch: Int) {
  val tables =
      mapOf(
          SearchResultKind.SEARCH_RESULT_KIND_BOUNDARY
              to Triple("boundaries_in_boundaries", "child_id", "parent_id"),
          SearchResultKind.SEARCH_RESULT_KIND_POINT
              to Triple("points_in_boundaries", "point_id", "boundary_id"),
          SearchResultKind.SEARCH_RESULT_KIND_TRAIL
              to Triple("trails_in_boundaries", "trail_id", "boundary_id"),
      )
  for ((kind, table) in tables) {
    val (name, child, parent) = table
    val byId = ranked.filter { it.result.kind == kind }.associateBy { it.result.id }
    if (byId.isEmpty()) {
      continue
    }

    connection
        .prepareStatement(
            """
            SELECT x.$child, b.name
            FROM $name x
            JOIN boundaries b ON b.id = x.$parent AND b.epoch = x.epoch
            WHERE x.$child = ANY(?) AND x.epoch = ?
            ORDER BY x.$child, b.area_meters2
            """)
        .apply {
          setArray(1, connection.createArrayOf("BIGINT", byId.keys.toTypedArray()))
          setInt(2, epoch)
        }
        .executeQuery()
        .use {
          while (it.next()) {
            val result = byId[it.getLong(1)]?.result ?: continue
            val boundary = it.getString(2)
            if (result.withinCount < WITHIN_LIMIT
                && boundary != result.name
                && boundary !in result.withinList) {
              result.addWithin(boundary)
            }
          }
        }
  }
}
