package org.trailcatalog

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.google.common.collect.ImmutableMap
import com.google.common.geometry.S2CellId
import io.javalin.Javalin
import io.javalin.http.Context
import io.javalin.http.Header
import io.javalin.http.HttpStatus
import org.trailcatalog.common.AlignableByteArrayOutputStream
import org.trailcatalog.common.DelegatingEncodedOutputStream
import org.trailcatalog.common.DeltaLatLngE7
import org.trailcatalog.common.simplifyLatLngE7
import org.trailcatalog.models.ENUM_SIZE
import org.trailcatalog.models.NATIONAL_PARK_CATEGORIES
import org.trailcatalog.models.PointCategory
import org.trailcatalog.models.RelationCategory
import org.trailcatalog.models.SourceType
import org.trailcatalog.models.WayCategory
import org.trailcatalog.s2.SimpleS2
import org.trailcatalog.s2.snapEpsilon
import java.net.URI
import java.sql.PreparedStatement
import java.sql.ResultSet
import java.time.Instant
import java.time.ZoneId
import java.util.Base64
import java.util.Stack
import kotlin.math.pow

private val connectionSource = createConnectionSource()
private val epochTracker = EpochTracker(connectionSource)
private val startTime = Instant.now().getEpochSecond() % 10000 // make it shorter

// The categories of trailcatalog's own icons, cells 1 through 21 of points_atlas.ts, plus the camp
// pitch and picnic site that share the camp site and picnic table icons. The cells after those are
// for the points trails.lat imports for trip planning, which trailcatalog doesn't show.
private val SHOWN_POINT_CATEGORIES =
    listOf(
        PointCategory.ACCESS_PARKING,
        PointCategory.ACCESS_TRAILHEAD,
        PointCategory.FACILITY_FIRE_BARBECUE,
        PointCategory.FACILITY_FIRE_PIT,
        PointCategory.FACILITY_PICNIC_SITE,
        PointCategory.FACILITY_PICNIC_TABLE,
        PointCategory.FACILITY_SHELTER,
        PointCategory.FACILITY_TOILETS,
        PointCategory.INFORMATION_GUIDE_POST,
        PointCategory.INFORMATION_VISITOR_CENTER,
        PointCategory.LODGING_CAMP_PITCH,
        PointCategory.LODGING_CAMP_SITE,
        PointCategory.LODGING_HUT_ALPINE,
        PointCategory.LODGING_HUT_WILDERNESS,
        PointCategory.NATURAL_CAVE_ENTRANCE,
        PointCategory.NATURAL_MOUNTAIN_PASS,
        PointCategory.NATURAL_PEAK,
        PointCategory.NATURAL_SADDLE,
        PointCategory.NATURAL_VOLCANO,
        PointCategory.NATURAL_WATERFALL,
        PointCategory.SIGHT_VIEWPOINT,
        PointCategory.WATER_DRINKING,
    ).map { it.id }.toTypedArray()

private fun ok(value: Any): Map<String, Any> = mapOf("kind" to "result", "value" to value)
private fun err(code: Int): Map<String, Any> = mapOf("kind" to "error", "code" to code)

fun main(args: Array<String>) {
  Javalin.create { config ->
    config.routes.post("/api/data", ::fetchData)
    config.routes.post("/api/data-packed", ::fetchDataPacked)
    config.routes.get("/api/fetch-overview/{token}", ::fetchOverview)
    config.routes.get("/api/fetch-coarse/{token}", ::fetchCoarse)
    config.routes.get("/api/fetch-fine/{token}", ::fetchFine)
    config.routes.get("/api/sitemap.xml", ::fetchSitemap)
  }.start(7070)
}

private data class WireBoundary(val id: Long, val type: Int, val name: String)

private data class WirePath(val id: Long, val type: Int, val vertices: ByteArray)

private data class WirePoint(val id: Long, val type: Int, val name: String?, val marker: ByteArray)

private data class WireTrail(
  val id: Long,
  val name: String,
  val type: Int,
  val pathIds: ByteArray,
  val bound: ByteArray,
  val marker: ByteArray,
  val elevationDownMeters: Float,
  val elevationUpMeters: Float,
  val lengthMeters: Float,
)

private fun fetchData(ctx: Context) {
  val mapper = ObjectMapper()
  val request = mapper.readTree(ctx.bodyInputStream())
  val keys = request.get("keys").elements()
  val responses = ArrayList<Any>()
  for (key in keys) {
    val type = key.get("method").asText()
    val request = key.get("request")
    when (type) {
      null -> throw IllegalArgumentException("Key has no type")
      "boundary" -> {
        val data = HashMap<String, Any>()
        val (idColumn, setId) = parseBoundaryId(request.get("boundary_id"))
        var found = false
        connectionSource.connection.use {
          val results = it.prepareStatement(
              "SELECT "
                  + "b.id, "
                  + "bi.readable_id, "
                  + "b.name, "
                  + "b.type, "
                  + "b.s2_polygon "
                  + "FROM boundaries b "
                  + "JOIN boundary_identifiers bi ON b.id = bi.numeric_id AND b.epoch = bi.epoch "
                  + "WHERE ${idColumn} = ? AND b.epoch = ?")
              .apply {
                setId(this, 1)
                setInt(2, epochTracker.epoch)
              }.executeQuery()
          if (results.next()) {
            found = true
            data["id"] = results.getLong(1).toString()
            data["readable_id"] = results.getString(2)
            data["name"] = results.getString(3)
            data["type"] = results.getInt(4)
            data["s2_polygon"] = String(Base64.getEncoder().encode(results.getBytes(5)))
          }
        }
        responses.add(if (found) ok(data) else err(404))
      }
      "boundaries_containing_boundary" -> {
        val data = ArrayList<HashMap<String, Any>>()
        val (idColumn, setId) = parseBoundaryId(request.get("child_id"))
        connectionSource.connection.use {
          val results = it.prepareStatement(
              "SELECT "
                  + "b.id, "
                  + "pi.readable_id, "
                  + "b.name, "
                  + "b.type "
                  + "FROM boundaries_in_boundaries bib "
                  + "JOIN boundary_identifiers bi "
                  + "ON bib.child_id = bi.numeric_id AND bib.epoch = bi.epoch "
                  + "JOIN boundaries b ON bib.parent_id = b.id AND bib.epoch = b.epoch "
                  + "JOIN boundary_identifiers pi ON b.id = pi.numeric_id AND b.epoch = pi.epoch "
                  + "WHERE ${idColumn} = ? AND bib.epoch = ? ")
              .apply {
                setId(this, 1)
                setInt(2, epochTracker.epoch)
              }.executeQuery()
          while (results.next()) {
            data.add(boundaryLinkFromResults(results))
          }
        }
        responses.add(ok(ImmutableMap.of("boundaries", data)))
      }
      "boundaries_containing_trail" -> {
        val data = ArrayList<HashMap<String, Any>>()
        val (idColumn, setId) = parseTrailId(request.get("trail_id"))
        connectionSource.connection.use {
          val results = it.prepareStatement(
              "SELECT "
                  + "b.id, "
                  + "bi.readable_id, "
                  + "b.name, "
                  + "b.type "
                  + "FROM trails_in_boundaries tib "
                  + "JOIN trail_identifiers ti ON tib.trail_id = ti.numeric_id AND tib.epoch = ti.epoch "
                  + "JOIN boundaries b ON tib.boundary_id = b.id AND tib.epoch = b.epoch "
                  + "JOIN boundary_identifiers bi ON b.id = bi.numeric_id AND b.epoch = bi.epoch "
                  + "WHERE ${idColumn} = ? AND tib.epoch = ?")
              .apply {
                setId(this, 1)
                setInt(2, epochTracker.epoch)
              }.executeQuery()
          while (results.next()) {
            data.add(boundaryLinkFromResults(results))
          }
        }
        responses.add(ok(ImmutableMap.of("boundaries", data)))
      }
      "epoch" -> {
        val date = epochDate(epochTracker.epoch).atStartOfDay(ZoneId.systemDefault())
        responses.add(ok(ImmutableMap.of("timestampS", date.toEpochSecond())))
      };
      "path_profiles_in_trail" -> {
        val data = ArrayList<HashMap<String, Any>>()
        val (idColumn, setId) = parseTrailId(request.get("trail_id"))
        connectionSource.connection.use {
          val results = it.prepareStatement(
              "SELECT "
                  + "pit.path_id, "
                  + "pe.height_samples_10m_meters "
                  + "FROM paths_in_trails pit "
                  + "JOIN trail_identifiers ti ON pit.trail_id = ti.numeric_id AND pit.epoch = ti.epoch "
                  + "JOIN path_elevations pe ON pit.path_id = pe.id AND pit.epoch = pe.epoch "
                  + "WHERE ${idColumn} = ? AND pit.epoch = ?")
              .apply {
                setId(this, 1)
                setInt(2, epochTracker.epoch)
              }.executeQuery()
          while (results.next()) {
            val path = HashMap<String, Any>()
            path["id"] = results.getLong(1)
            path["granularity_meters"] = 10
            path["samples_meters"] = String(Base64.getEncoder().encode(results.getBytes(2)))
            data.add(path)
          }
          responses.add(ok(ImmutableMap.of("profiles", data)))
        }
      }
      "search_boundaries" -> {
        responses.add(ok(executeSearchBoundaries(request.get("query").asText(), 10)))
      }
      "search_trails" -> {
        responses.add(
            ok(executeSearchTrails(
                request.get("query").asText(),
                request.get("limit").asInt().coerceIn(1, 100))))
      }
      "trail" -> {
        val data = HashMap<String, Any>()
        val (idColumn, setId) = parseTrailId(request.get("trail_id"))
        var found = false
        connectionSource.connection.use {
          val results = it.prepareStatement(
              "SELECT "
                  + "t.id, "
                  + "ti.readable_id, "
                  + "t.name, "
                  + "t.type, "
                  + "t.path_ids, "
                  + "t.bound_degrees_e7, "
                  + "t.marker_degrees_e7, "
                  + "t.elevation_down_meters, "
                  + "t.elevation_up_meters, "
                  + "t.length_meters "
                  + "FROM trails t "
                  + "JOIN trail_identifiers ti ON t.id = ti.numeric_id AND t.epoch = ti.epoch "
                  + "WHERE ${idColumn} = ? AND t.epoch = ?")
              .apply {
                setId(this, 1)
                setInt(2, epochTracker.epoch)
              }.executeQuery()
          if (results.next()) {
            found = true
            data["id"] = results.getLong(1).toString()
            data["readable_id"] = results.getString(2)
            data["name"] = results.getString(3)
            data["type"] = results.getInt(4)
            data["path_ids"] = String(Base64.getEncoder().encode(results.getBytes(5)))
            data["bound"] = String(Base64.getEncoder().encode(results.getBytes(6)))
            data["marker"] = String(Base64.getEncoder().encode(results.getBytes(7)))
            data["elevation_down_meters"] = results.getFloat(8)
            data["elevation_up_meters"] = results.getFloat(9)
            data["length_meters"] = results.getFloat(10)
          }
        }
        responses.add(if (found) ok(data) else err(404))
      }
      "trail_tags" -> {
        val (idColumn, setId) = parseTrailId(request.get("trail_id"))
        var tags: JsonNode = mapper.createObjectNode()
        connectionSource.connection.use {
          val results = it.prepareStatement(
              "SELECT st.tags::text "
                  + "FROM source_tags st "
                  + "JOIN trail_identifiers ti "
                  + "ON st.source_id = ti.numeric_id AND st.epoch = ti.epoch "
                  + "WHERE ${idColumn} = ? AND st.source_type = ? AND st.epoch = ?")
              .apply {
                setId(this, 1)
                setShort(2, SourceType.RELATION.id.toShort())
                setInt(3, epochTracker.epoch)
              }.executeQuery()
          if (results.next()) {
            tags = mapper.readTree(results.getString(1))
          }
        }
        responses.add(ok(ImmutableMap.of("tags", tags)))
      }
      "trails_in_boundary" -> {
        val data = ArrayList<HashMap<String, Any>>()
        val (idColumn, setId) = parseBoundaryId(request.get("boundary_id"))
        connectionSource.connection.use {
          val results = it.prepareStatement(
              "SELECT "
                  + "t.id, "
                  + "ti.readable_id, "
                  + "t.name, "
                  + "t.type, "
                  + "t.elevation_down_meters, "
                  + "t.elevation_up_meters, "
                  + "t.length_meters "
                  + "FROM trails t "
                  + "RIGHT JOIN trails_in_boundaries tib "
                  + "ON t.id = tib.trail_id AND t.epoch = tib.epoch "
                  + "JOIN trail_identifiers ti "
                  + "ON tib.trail_id = ti.numeric_id AND tib.epoch = ti.epoch "
                  + "JOIN boundary_identifiers bi "
                  + "ON tib.boundary_id = bi.numeric_id AND tib.epoch = bi.epoch "
                  + "WHERE ${idColumn} = ? AND tib.epoch = ? "
                  + "ORDER BY t.length_meters DESC")
              .apply {
                setId(this, 1)
                setInt(2, epochTracker.epoch)
              }.executeQuery()
          while (results.next()) {
            val trail = HashMap<String, Any>()
            trail["id"] = results.getLong(1).toString()
            trail["readable_id"] = results.getString(2)
            trail["name"] = results.getString(3)
            trail["type"] = results.getInt(4)
            trail["elevation_down_meters"] = results.getFloat(5)
            trail["elevation_up_meters"] = results.getFloat(6)
            trail["length_meters"] = results.getFloat(7)
            data.add(trail)
          }
        }
        responses.add(ok(ImmutableMap.of("trails", data)))
      }
    }
  }
  ctx.json(HashMap<String, Any>().also {
    it["values"] = responses
  })
}

private fun parseBoundaryId(id: JsonNode):
    Pair<String, (statement: PreparedStatement, index: Int) -> Unit> {
  return parseId(id, "bi")
}

private fun parseTrailId(id: JsonNode):
    Pair<String, (statement: PreparedStatement, index: Int) -> Unit> {
  return parseId(id, "ti")
}

// Picks the column of the identifiers table aliased as table that the id names.
private fun parseId(id: JsonNode, table: String):
    Pair<String, (statement: PreparedStatement, index: Int) -> Unit> {
  val idColumn: String
  val setId: (statement: PreparedStatement, index: Int) -> Unit
  if (id.has("numeric")) {
    idColumn = "${table}.numeric_id"
    setId = { statement, index -> statement.setLong(index, id.get("numeric").asLong()) }
  } else if (id.has("readable")) {
    idColumn = "${table}.readable_id"
    setId = { statement, index -> statement.setString(index, id.get("readable").asText()) }
  } else {
    throw IllegalArgumentException("Unknown type of ID")
  }
  return Pair(idColumn, setId)
}

// Reads a boundary from the id, readable id, name, and type in the first four columns.
private fun boundaryLinkFromResults(results: ResultSet): HashMap<String, Any> {
  val boundary = HashMap<String, Any>()
  boundary["id"] = results.getLong(1).toString()
  boundary["readable_id"] = results.getString(2)
  boundary["name"] = results.getString(3)
  boundary["type"] = results.getInt(4)
  return boundary
}

private val PARK_CATEGORIES = NATIONAL_PARK_CATEGORIES.map { it.id }.toTypedArray()

// Climbing sites are for trails.lat, and a crag isn't a place to look for trails.
private val UNSEARCHED_BOUNDARY_CATEGORIES =
    RelationCategory.entries
        .filter { RelationCategory.BOUNDARY_CLIMBING.isParentOf(it) }
        .map { it.id }
        .toTypedArray()

// Ranks each boundary on its best name, see SearchNames.kt#bestNames.
private fun executeSearchBoundaries(rawQuery: String, limit: Int): Map<String, Any> {
  val query = sanitizeSearchQuery(rawQuery)
  if (query.isEmpty()) {
    return ImmutableMap.of("results", listOf<Any>(), "boundaries", mapOf<String, Any>())
  }

  val data = ArrayList<HashMap<String, Any>>()
  val requiredBoundaries = HashSet<Long>();
  connectionSource.connection.use {
    it.createStatement().executeUpdate("SET pg_trgm.strict_word_similarity_threshold TO 0.2")
    val results = it.prepareStatement(
        """
        SELECT sr.id, sr.name, sr.type, ARRAY_REMOVE(ARRAY_AGG(bib.parent_id), NULL)
        FROM (
          SELECT b.id, b.name, b.type, nm.score - $BOUNDARY_AREA_BONUS AS score
          FROM (${bestNames("boundary_names", 0.8)}) nm
          JOIN boundaries b ON b.id = nm.id AND b.epoch = ? AND NOT b.type = ANY(?)
          ORDER BY score
          LIMIT ?
        ) sr
        LEFT JOIN boundaries_in_boundaries bib ON sr.id = bib.child_id AND bib.epoch = ?
        GROUP BY 1, 2, 3, sr.score
        ORDER BY sr.score
        """)
        .apply {
          var next = bindBestNames(query, epochTracker.epoch)
          setInt(next++, epochTracker.epoch)
          setArray(next++, it.createArrayOf("INTEGER", UNSEARCHED_BOUNDARY_CATEGORIES))
          setInt(next++, limit)
          setInt(next, epochTracker.epoch)
        }.executeQuery()
    while (results.next()) {
      val boundary = HashMap<String, Any>()
      boundary["id"] = results.getLong(1).toString()
      boundary["name"] = results.getString(2)
      boundary["type"] = results.getInt(3)
      @Suppress("UNCHECKED_CAST")
      val boundaries = results.getArray(4).getArray() as Array<Long>
      boundary["boundaries"] = boundaries.map { it.toString() }
      requiredBoundaries.addAll(boundaries)
      data.add(boundary)
    }
  }

  val boundaries = fetchBoundaries(requiredBoundaries)
  return ImmutableMap.of("results", data, "boundaries", boundaries)
}

// Scored the same way as executeSearchBoundaries, without an area to rank on.
private fun executeSearchTrails(rawQuery: String, limit: Int): Map<String, Any> {
  val query = sanitizeSearchQuery(rawQuery)
  if (query.isEmpty()) {
    return ImmutableMap.of("results", listOf<Any>(), "boundaries", mapOf<String, Any>())
  }

  val data = ArrayList<HashMap<String, Any>>()
  val requiredBoundaries = HashSet<Long>();
  connectionSource.connection.use {
    it.createStatement().executeUpdate("SET pg_trgm.strict_word_similarity_threshold TO 0.3")
    val results = it.prepareStatement(
        """
        SELECT
          sr.id,
          sr.readable_id,
          sr.name,
          sr.bound_degrees_e7,
          sr.marker_degrees_e7,
          sr.elevation_down_meters,
          sr.elevation_up_meters,
          sr.length_meters,
          ARRAY_REMOVE(ARRAY_AGG(tib.boundary_id), NULL)
        FROM (
          SELECT
            t.id,
            ti.readable_id,
            t.name,
            t.bound_degrees_e7,
            t.marker_degrees_e7,
            t.elevation_down_meters,
            t.elevation_up_meters,
            t.length_meters,
            nm.score
          FROM (${bestNames("trail_names", 0.7)}) nm
          JOIN trails t ON t.id = nm.id AND t.epoch = ?
          JOIN trail_identifiers ti ON t.id = ti.numeric_id AND t.epoch = ti.epoch
          ORDER BY nm.score
          LIMIT ?
        ) sr
        LEFT JOIN trails_in_boundaries tib ON sr.id = tib.trail_id AND tib.epoch = ?
        GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, sr.score
        ORDER BY sr.score
        """)
        .apply {
          var next = bindBestNames(query, epochTracker.epoch)
          setInt(next++, epochTracker.epoch)
          setInt(next++, limit)
          setInt(next, epochTracker.epoch)
        }.executeQuery()
    while (results.next()) {
      val trail = HashMap<String, Any>()
      trail["id"] = results.getLong(1).toString()
      trail["readable_id"] = results.getString(2)
      trail["name"] = results.getString(3)
      trail["bound"] = String(Base64.getEncoder().encode(results.getBytes(4)))
      trail["marker"] = String(Base64.getEncoder().encode(results.getBytes(5)))
      trail["elevation_down_meters"] = results.getFloat(6)
      trail["elevation_up_meters"] = results.getFloat(7)
      trail["length_meters"] = results.getFloat(8)
      @Suppress("UNCHECKED_CAST")
      val boundaries = results.getArray(9).getArray() as Array<Long>
      trail["boundaries"] = boundaries.map { it.toString() }
      requiredBoundaries.addAll(boundaries)
      data.add(trail)
    }
  }

  val boundaries = fetchBoundaries(requiredBoundaries)
  return ImmutableMap.of("results", data, "boundaries", boundaries)
}

private fun fetchBoundaries(requiredBoundaries: HashSet<Long>): Map<String, Any> {
  val boundaries = HashMap<String, Any>()
  connectionSource.connection.use {
    val results = it.prepareStatement(
        "SELECT "
            + "b.id, "
            + "bi.readable_id, "
            + "b.name, "
            + "b.type "
            + "FROM boundaries b "
            + "JOIN boundary_identifiers bi ON b.id = bi.numeric_id AND b.epoch = bi.epoch "
            + "WHERE b.id = ANY (?) AND b.epoch = ?")
        .apply {
          setArray(1, it.createArrayOf("BIGINT", requiredBoundaries.toArray()))
          setInt(2, epochTracker.epoch)
        }.executeQuery()
    while (results.next()) {
      boundaries[results.getLong(1).toString()] =
          ImmutableMap.of(
              "readable_id",
              results.getString(2),
              "name",
              results.getString(3),
              "type",
              results.getInt(4))
    }
  }
  return boundaries;
}

// The home page, every park holding a trail, and the trails in those parks. Epoch 26102500 had 840
// such parks and 9,363 trails, well under the 50,000 URLs one sitemap can hold.
// https://www.sitemaps.org/protocol.html
private fun fetchSitemap(ctx: Context) {
  ctx.contentType("application/xml")
  if (addETagAndCheckCached(ctx)) {
    return
  }

  val xml = StringBuilder()
  xml.append("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n")
  xml.append("<urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">\n")
  appendSitemapUrl("/", xml)
  connectionSource.connection.use {
    val results = it.prepareStatement(
        "WITH parks AS ("
            + "  SELECT b.id FROM boundaries b "
            + "  WHERE b.epoch = ? AND b.type = ANY(?) AND EXISTS ("
            + "    SELECT 1 FROM trails_in_boundaries tib "
            + "    WHERE tib.boundary_id = b.id AND tib.epoch = b.epoch)"
            + ") "
            + "SELECT '/boundary/' || bi.readable_id "
            + "FROM parks p "
            + "JOIN boundary_identifiers bi ON p.id = bi.numeric_id AND bi.epoch = ? "
            + "UNION "
            + "SELECT '/trail/' || ti.readable_id "
            + "FROM trails_in_boundaries tib "
            + "JOIN parks p ON tib.boundary_id = p.id "
            + "JOIN trail_identifiers ti ON tib.trail_id = ti.numeric_id AND tib.epoch = ti.epoch "
            + "WHERE tib.epoch = ? "
            + "ORDER BY 1")
        .apply {
          setInt(1, epochTracker.epoch)
          setArray(2, it.createArrayOf("INTEGER", PARK_CATEGORIES))
          setInt(3, epochTracker.epoch)
          setInt(4, epochTracker.epoch)
        }.executeQuery()
    while (results.next()) {
      appendSitemapUrl(results.getString(1), xml)
    }
  }
  xml.append("</urlset>\n")
  ctx.result(xml.toString())
}

// Readable ids keep non-ASCII letters, and sitemaps only take ASCII URLs.
private fun appendSitemapUrl(path: String, xml: StringBuilder) {
  xml.append("  <url><loc>")
  xml.append(URI("https", "trailcatalog.org", path, null).toASCIIString())
  xml.append("</loc></url>\n")
}

private fun fetchOverview(ctx: Context) {
  ctx.contentType("application/octet-stream")
  if (addETagAndCheckCached(ctx)) {
    return
  }

  val cell = S2CellId.fromToken(ctx.pathParam("token"))

  val trails = fetchTrails(cell, SimpleS2.HIGHEST_OVERVIEW_INDEX_LEVEL)
  val bytes = AlignableByteArrayOutputStream()
  val output = DelegatingEncodedOutputStream(bytes)

  output.writeVarInt(trails.size)
  for (trail in trails) {
    output.writeVarLong(trail.id)
    val asUtf8 = trail.name.toByteArray(Charsets.UTF_8)
    output.writeVarInt(asUtf8.size)
    output.write(asUtf8)
    output.writeVarInt(trail.type)
    output.writeVarInt(trail.pathIds.size / 8)
    output.flush()
    bytes.align(8)
    output.write(trail.pathIds)
    output.write(trail.marker)
    output.writeFloat(trail.elevationDownMeters)
    output.writeFloat(trail.elevationUpMeters)
    output.writeFloat(trail.lengthMeters)
  }

  ctx.result(bytes.toByteArray())
}

private fun fetchCoarse(ctx: Context) {
  ctx.contentType("application/octet-stream")
  if (addETagAndCheckCached(ctx)) {
    return
  }

  val cell = S2CellId.fromToken(ctx.pathParam("token"))

  val paths = HashMap<S2CellId, ArrayList<WirePath>>()
  val (min, max) = cellRange(cell, SimpleS2.HIGHEST_COARSE_INDEX_LEVEL)
  connectionSource.connection.use {
    val results = it.prepareStatement(
        "SELECT p.id, p.cell, p.type, p.lat_lng_degrees "
            + "FROM paths p "
            + "JOIN paths_in_trails pit "
            + "ON p.id = pit.path_id AND p.epoch = pit.epoch "
            + "WHERE p.cell BETWEEN ? AND ? "
            + "AND p.epoch = ? "
    ).apply {
      setLong(1, min)
      setLong(2, max)
      setInt(3, epochTracker.epoch)
    }.executeQuery()
    while (results.next()) {
      val id = results.getLong(1)
      val raw = S2CellId(results.getLong(2))
      val cell =
        if (raw.level() > SimpleS2.HIGHEST_FINE_INDEX_LEVEL)
          raw.parent(SimpleS2.HIGHEST_FINE_INDEX_LEVEL)
        else
          raw
      val group = paths.computeIfAbsent(cell) { ArrayList() }
      group
        .add(
          WirePath(
              id = id,
              type = results.getInt(3),
              vertices = results.getBytes(4),
          ))
    }
  }
  val bytes = AlignableByteArrayOutputStream()
  val output = DelegatingEncodedOutputStream(bytes)
  output.writeVarInt(paths.size)
  for ((cell, group) in paths) {
    output.writeLong(cell.id())
    writeDetailPaths(group, output, snapFor(ctx, SIMPLIFICATION_EPSILON))
  }
  ctx.result(bytes.toByteArray())
}

private fun fetchFine(ctx: Context) {
  ctx.contentType("application/octet-stream")
  if (addETagAndCheckCached(ctx)) {
    return
  }

  val cell = S2CellId.fromToken(ctx.pathParam("token"))

  val paths = ArrayList<WirePath>()
  val (min, max) = cellRange(cell, SimpleS2.HIGHEST_FINE_INDEX_LEVEL)
  connectionSource.connection.use {
    val results = it.prepareStatement(
        "SELECT p.id, p.type, p.lat_lng_degrees "
            + "FROM paths p "
            + "LEFT JOIN paths_in_trails pit "
            + "ON p.id = pit.path_id AND p.epoch = pit.epoch "
            + "WHERE p.cell BETWEEN ? AND ? "
            + "AND p.epoch = ? "
            + "AND ("
            + "  pit.path_id IS NOT NULL "
            + "  OR public.enumADescendsB(p.type, ?, ?) "
            + "  OR public.enumADescendsB(p.type, ?, ?) "
            + "  OR public.enumADescendsB(p.type, ?, ?) "
            + ") "
    ).apply {
      setLong(1, min)
      setLong(2, max)
      setInt(3, epochTracker.epoch)
      setInt(4, WayCategory.PATH.id)
      setInt(5, ENUM_SIZE)
      setInt(6, WayCategory.PISTE.id)
      setInt(7, ENUM_SIZE)
      setInt(8, WayCategory.ROAD_TRACK.id)
      setInt(9, ENUM_SIZE)
    }.executeQuery()
    while (results.next()) {
      val id = results.getLong(1)
      paths.add(
          WirePath(
              id = id,
              type = results.getInt(2),
              vertices = results.getBytes(3),
          ))
    }
  }

  val points = ArrayList<WirePoint>()
  connectionSource.connection.use {
    val results = it.prepareStatement(
        "SELECT p.id, p.type, p.name, p.marker_degrees_e7 "
            + "FROM points p "
            + "WHERE p.cell BETWEEN ? AND ? "
            + "AND p.epoch = ? "
            + "AND p.type = ANY(?) "
    ).apply {
      setLong(1, min)
      setLong(2, max)
      setInt(3, epochTracker.epoch)
      setArray(4, it.createArrayOf("INTEGER", SHOWN_POINT_CATEGORIES))
    }.executeQuery()
    while (results.next()) {
      points.add(
          WirePoint(
              id = results.getLong(1),
              type = results.getInt(2),
              name = results.getString(3),
              marker = results.getBytes(4),
          ))
    }
  }

  val bytes = AlignableByteArrayOutputStream()
  val output = DelegatingEncodedOutputStream(bytes)
  writeDetailPaths(paths, output, snapFor(ctx, null))
  writeDetailPoints(points, bytes, output)
  ctx.result(bytes.toByteArray())
}

private fun fetchDataPacked(ctx: Context) {
  ctx.contentType("application/octet-stream")
  if (addETagAndCheckCached(ctx)) {
    return
  }

  val mapper = ObjectMapper()
  val request = mapper.readTree(ctx.bodyInputStream())
  val precise = request.get("precise").asBoolean()
  val trailId = request.get("trail_id").asLong()

  val trail = connectionSource.connection.use {
    val results = it.prepareStatement(
        "SELECT ${WIRE_TRAIL_COLUMNS} FROM trails t WHERE t.id = ? AND t.epoch = ?").apply {
      setLong(1, trailId)
      setInt(2, epochTracker.epoch)
    }.executeQuery()

    if (!results.next()) {
      ctx.status(HttpStatus.NOT_FOUND)
      return@fetchDataPacked
    }

    readWireTrail(results)
  }

  val paths = ArrayList<WirePath>()
  connectionSource.connection.use {
    val results = it.prepareStatement(
        "SELECT p.id, p.type, p.lat_lng_degrees "
            + "FROM paths p "
            + "JOIN paths_in_trails pit "
            + "ON p.id = pit.path_id AND p.epoch = pit.epoch "
            + "WHERE "
            + "pit.trail_id = ? "
            + "AND pit.epoch = ?").apply {
      setLong(1, trailId)
      setInt(2, epochTracker.epoch)
    }.executeQuery()

    while (results.next()) {
      val id = results.getLong(1)
      paths.add(
          WirePath(
              id = id,
              type = results.getInt(2),
              vertices = results.getBytes(3),
          ))
    }
  }

  val bytes = AlignableByteArrayOutputStream()
  val output = DelegatingEncodedOutputStream(bytes)
  writeDetailPaths(paths, output, if (precise) null else SIMPLIFICATION_EPSILON)
  writeDetailTrails(listOf(trail), bytes, output)
  ctx.result(bytes.toByteArray())
}

private fun writeDetailPaths(
    paths: List<WirePath>,
    output: DelegatingEncodedOutputStream,
    epsilon: Double?) {
  output.writeVarInt(paths.size)
  for (path in paths) {
    output.writeVarLong(path.id)
    output.writeVarInt(path.type)
    // DeltaLatLngE7 carries its own point count and needs no alignment, so a precise path goes out
    // exactly as it sits in the column.
    output.write(if (epsilon == null) path.vertices else simplify(path.vertices, epsilon))
  }
}

private fun writeDetailPoints(
    points: List<WirePoint>,
    bytes: AlignableByteArrayOutputStream,
    output: DelegatingEncodedOutputStream) {
  output.writeVarInt(points.size)
  for (point in points) {
    output.writeVarLong(point.id)
    output.writeVarInt(point.type)
    (point.name ?: "").toByteArray(Charsets.UTF_8).let {
      output.writeVarInt(it.size)
      output.write(it)
    }
    output.write(point.marker)
  }
}

private fun writeDetailTrails(
    trails: List<WireTrail>,
    bytes: AlignableByteArrayOutputStream,
    output: DelegatingEncodedOutputStream) {
  output.writeVarInt(trails.size)
  for (trail in trails) {
    output.writeVarLong(trail.id)
    val asUtf8 = trail.name.toByteArray(Charsets.UTF_8)
    output.writeVarInt(asUtf8.size)
    output.write(asUtf8)
    output.writeVarInt(trail.type)
    output.writeVarInt(trail.pathIds.size / 8)
    output.flush()
    bytes.align(8)
    output.write(trail.pathIds)
    output.write(trail.bound)
    output.write(trail.marker)
    output.writeFloat(trail.elevationDownMeters)
    output.writeFloat(trail.elevationUpMeters)
    output.writeFloat(trail.lengthMeters)
  }
}

private fun fetchTrails(cell: S2CellId, bottom: Int): List<WireTrail> {
  val trails = ArrayList<WireTrail>()
  val (min, max) = cellRange(cell, bottom)
  connectionSource.connection.use {
    val results = it.prepareStatement(
        "SELECT ${WIRE_TRAIL_COLUMNS} FROM trails t WHERE t.cell BETWEEN ? AND ? AND t.epoch = ?"
    ).apply {
      setLong(1, min)
      setLong(2, max)
      setInt(3, epochTracker.epoch)
    }.executeQuery()
    while (results.next()) {
      trails.add(readWireTrail(results))
    }
  }
  return trails
}

// The columns readWireTrail reads, in order.
private const val WIRE_TRAIL_COLUMNS =
    "t.id, t.name, t.type, t.path_ids, t.bound_degrees_e7, t.marker_degrees_e7, " +
        "t.elevation_down_meters, t.elevation_up_meters, t.length_meters"

private fun readWireTrail(results: ResultSet): WireTrail {
  return WireTrail(
      id = results.getLong(1),
      name = results.getString(2),
      type = results.getInt(3),
      pathIds = results.getBytes(4),
      bound = results.getBytes(5),
      marker = results.getBytes(6),
      elevationDownMeters = results.getFloat(7),
      elevationUpMeters = results.getFloat(8),
      lengthMeters = results.getFloat(9),
  )
}

// A cell at or below the index's deepest level answers for everything under it, and a cell above it
// only for what sits in that exact cell, because the client requests each ancestor separately.
private fun cellRange(cell: S2CellId, bottom: Int): Pair<Long, Long> {
  return if (cell.level() >= bottom) {
    Pair(cell.rangeMin().id(), cell.rangeMax().id())
  } else {
    Pair(cell.id(), cell.id())
  }
}

private fun addETagAndCheckCached(ctx: Context): Boolean {
  ("\"${startTime}-${epochTracker.epoch}\"").let { etag ->
    ctx.header("ETag", etag)
    val requestETag = ctx.header(Header.IF_NONE_MATCH)
    // nginx weakens etags when gzipping, so we have to also check if the user sent us a weak etag.
    if (etag == requestETag || "W/${etag}" == requestETag) {
      ctx.status(HttpStatus.NOT_MODIFIED)
      return true
    }
  }
  return false
}

// One pixel at zoom 10. The Mercator world is 2 units wide and a pixel at zoom z is 2^-(z+7).
private val SIMPLIFICATION_EPSILON = 1 / 2.0.pow(17.0)

// The error the client accepts, from the S2 level it names. A client that names none predates the
// parameter and gets what the endpoint always gave it.
private fun snapFor(ctx: Context, absent: Double?): Double? {
  return ctx.queryParam("snap")?.toIntOrNull()?.let { snapEpsilon(it) } ?: absent
}

private fun simplify(latLngDegrees: ByteArray, epsilon: Double): ByteArray {
  return DeltaLatLngE7.encode(
      simplifyLatLngE7(DeltaLatLngE7.decode(latLngDegrees), epsilon))
}
