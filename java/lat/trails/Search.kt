package lat.trails

import com.google.common.geometry.S2Cap
import com.google.common.geometry.S2Cell
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
import org.trailcatalog.BOUNDARY_AREA_BONUS
import org.trailcatalog.bestNames
import org.trailcatalog.bindBestNames
import org.trailcatalog.sanitizeSearchQuery
import org.trailcatalog.models.PointCategory
import org.trailcatalog.models.RelationCategory
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

// Of the boundaries around a result, how many to name
private const val WITHIN_LIMIT = 3

// A boundary lies somewhere in its cell and the cell's neighbors, so the distance to the nearest of
// them is never more than the distance to the boundary. See SpatialIndex.kt#polygonToCell.
// Measuring to the cell's center instead puts downtown Palo Alto 9 km from Palo Alto.
private class Candidate(
    val result: SearchResult.Builder,
    val cells: List<S2Cell>,
    val score: Double,
)

fun search(request: SearchRequest, connection: Connection, epoch: Int): SearchResponse {
  val query = sanitizeSearchQuery(request.query)
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

  val target = center.toPoint()
  val ranked =
      candidates
          .distinctBy { it.result.kind to it.result.id }
          .sortedBy {
            val distance = it.cells.minOf { c -> c.getDistance(target) }.toAngle().earthMeters()
            it.score + DISTANCE_WEIGHT * ln(1 + distance / radiusMeters)
          }
          .take(RESULT_LIMIT)
  fillBoundaryBounds(ranked, connection, epoch)
  fillWithin(ranked, connection, epoch)
  return SearchResponse.newBuilder().addAllResults(ranked.map { it.result.build() }).build()
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
          candidates.add(Candidate(result, cellAndNeighbors(cell), it.getDouble(6)))
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
          candidates.add(Candidate(result, pointCell(markerOf(it.getBytes(5))), it.getDouble(7)))
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
          WHERE p.type <> ? ${near ?: ""}
          ORDER BY 6
          LIMIT ?
          """)
      .apply {
        var next = bindBestNames(query, epoch)
        setInt(next++, epoch)
        // TODO(april): routes are imported for search but stay out of its results for now.
        setInt(next++, PointCategory.CLIMBING_ROUTE.id)
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
          candidates.add(Candidate(result, pointCell(marker), it.getDouble(6)))
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

private fun cellAndNeighbors(cell: S2CellId): List<S2Cell> {
  val cells = arrayListOf(cell)
  cell.getAllNeighbors(cell.level(), cells)
  return cells.map { S2Cell(it) }
}

private fun pointCell(point: S2LatLng): List<S2Cell> {
  return listOf(S2Cell(S2CellId.fromLatLng(point)))
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

// Boundaries rank by their cell, but a cell can be several times the size of the boundary inside
// it, so the camera gets the polygon's own bound. Only the results pay to decode a polygon, which
// for a country is megabytes.
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

// Routes aren't searchable, so a crag or climbing area would only ever say where a trail, a place,
// or another climbing site is, and that's better said by the park or county around it.
private val UNLISTED_WITHIN_CATEGORIES =
    RelationCategory.entries
        .filter { RelationCategory.BOUNDARY_CLIMBING.isParentOf(it) }
        .map { it.id }
        .toTypedArray()

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
            WHERE x.$child = ANY(?) AND x.epoch = ? AND NOT b.type = ANY(?)
            ORDER BY x.$child, b.area_meters2
            """)
        .apply {
          setArray(1, connection.createArrayOf("BIGINT", byId.keys.toTypedArray()))
          setInt(2, epoch)
          setArray(3, connection.createArrayOf("INTEGER", UNLISTED_WITHIN_CATEGORIES))
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
