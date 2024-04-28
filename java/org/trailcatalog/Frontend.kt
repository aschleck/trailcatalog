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
import org.trailcatalog.models.ENUM_SIZE
import org.trailcatalog.models.WayCategory
import org.trailcatalog.s2.SimpleS2
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.sql.PreparedStatement
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.util.Base64
import java.util.Stack
import kotlin.math.abs
import kotlin.math.ln
import kotlin.math.pow
import kotlin.math.sin
import kotlin.math.sqrt

private val connectionSource = createConnectionSource()
private val epochTracker = EpochTracker(connectionSource)
private val startTime = Instant.now().getEpochSecond() % 10000 // make it shorter

fun main(args: Array<String>) {
  val app = Javalin.create {}.start(7070)
  app.post("/api/data", ::fetchData)
  app.post("/api/data-packed", ::fetchDataPacked)
  app.get("/api/fetch-overview/{token}", ::fetchOverview)
  app.get("/api/fetch-coarse/{token}", ::fetchCoarse)
  app.get("/api/fetch-fine/{token}", ::fetchFine)
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
    val type = key.get("type").asText()
    when (type) {
      null -> throw IllegalArgumentException("Key has no type")
      "boundary" -> {
        val data = HashMap<String, Any>()
        val id = key.get("id").asLong()
        connectionSource.connection.use {
          val results = it.prepareStatement(
              "SELECT "
                  + "name, "
                  + "type, "
                  + "s2_polygon "
                  + "FROM boundaries "
                  + "WHERE id = ? AND epoch = ?")
              .apply {
                setLong(1, id)
                setInt(2, epochTracker.epoch)
              }.executeQuery()
          if (!results.next()) {
            ctx.status(HttpStatus.NOT_FOUND)
            return@fetchData
          }
          data["id"] = id
          data["name"] = results.getString(1)
          data["type"] = results.getInt(2)
          data["s2_polygon"] = String(Base64.getEncoder().encode(results.getBytes(3)))
        }
        responses.add(data)
      }
      "boundaries_containing_boundary" -> {
        val data = ArrayList<HashMap<String, Any>>()
        val id = key.get("child_id").asLong()
        connectionSource.connection.use {
          val results = it.prepareStatement(
              "SELECT "
                  + "b.id, "
                  + "b.name, "
                  + "b.type "
                  + "FROM boundaries_in_boundaries bib "
                  + "JOIN boundaries b ON bib.parent_id = b.id AND bib.epoch = b.epoch "
                  + "WHERE bib.child_id = ? AND bib.epoch = ? ")
              .apply {
                setLong(1, id)
                setInt(2, epochTracker.epoch)
              }.executeQuery()
          while (results.next()) {
            val boundary = HashMap<String, Any>()
            boundary["id"] = results.getLong(1).toString()
            boundary["name"] = results.getString(2)
            boundary["type"] = results.getInt(3)
            data.add(boundary)
          }
        }
        responses.add(ImmutableMap.of("boundaries", data))
      }
      "boundaries_containing_trail" -> {
        val data = ArrayList<HashMap<String, Any>>()
        val (idColumn, setId) = parseTrailId(key.get("trail_id"))
        connectionSource.connection.use {
          val results = it.prepareStatement(
              "SELECT "
                  + "b.id, "
                  + "b.name, "
                  + "b.type "
                  + "FROM trails_in_boundaries tib "
                  + "JOIN trail_identifiers ti ON tib.trail_id = ti.numeric_id AND tib.epoch = ti.epoch "
                  + "JOIN boundaries b ON tib.boundary_id = b.id AND tib.epoch = b.epoch "
                  + "WHERE ${idColumn} = ? AND tib.epoch = ?")
              .apply {
                setId(this, 1)
                setInt(2, epochTracker.epoch)
              }.executeQuery()
          while (results.next()) {
            val boundary = HashMap<String, Any>()
            boundary["id"] = results.getLong(1).toString()
            boundary["name"] = results.getString(2)
            boundary["type"] = results.getInt(3)
            data.add(boundary)
          }
        }
        responses.add(ImmutableMap.of("boundaries", data))
      }
      "epoch" -> {
        val year = epochTracker.epoch / 100_00
        val month = epochTracker.epoch / 100 - year * 100
        val day = epochTracker.epoch - year * 100_00 - month * 100 + 1
        val date = LocalDate.of(2000 + year, month, day).atStartOfDay(ZoneId.systemDefault());
        responses.add(ImmutableMap.of("timestampS", date.toEpochSecond()))
      };
      "path_profiles_in_trail" -> {
        val data = ArrayList<HashMap<String, Any>>()
        val (idColumn, setId) = parseTrailId(key.get("trail_id"))
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
          responses.add(ImmutableMap.of("profiles", data))
        }
      }
      "search_boundaries" -> {
        responses.add(executeSearchBoundaries(key.get("query").asText(), 10))
      }
      "search_trails" -> {
        responses.add(
            executeSearchTrails(
                key.get("query").asText(),
                key.get("limit").asInt().coerceIn(1, 100)))
      }
      "trail" -> {
        val data = HashMap<String, Any>()
        val (idColumn, setId) = parseTrailId(key.get("trail_id"))
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
          if (!results.next()) {
            ctx.status(HttpStatus.NOT_FOUND)
            return@fetchData
          }
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
        responses.add(data)
      }
      "trails_in_boundary" -> {
        val data = ArrayList<HashMap<String, Any>>()
        val id = key.get("boundary_id").asLong()
        connectionSource.connection.use {
          val results = it.prepareStatement(
              "SELECT "
                  + "id, "
                  + "name, "
                  + "type, "
                  + "elevation_down_meters, "
                  + "elevation_up_meters, "
                  + "length_meters "
                  + "FROM trails t "
                  + "RIGHT JOIN trails_in_boundaries tib "
                  + "ON t.id = tib.trail_id AND t.epoch = tib.epoch "
                  + "WHERE tib.boundary_id = ? AND tib.epoch = ? "
                  + "ORDER BY length_meters DESC")
              .apply {
                setLong(1, id)
                setInt(2, epochTracker.epoch)
              }.executeQuery()
          while (results.next()) {
            val trail = HashMap<String, Any>()
            trail["id"] = results.getLong(1).toString()
            trail["name"] = results.getString(2)
            trail["type"] = results.getInt(3)
            trail["elevation_down_meters"] = results.getFloat(4)
            trail["elevation_up_meters"] = results.getFloat(5)
            trail["length_meters"] = results.getFloat(6)
            data.add(trail)
          }
        }
        responses.add(ImmutableMap.of("trails", data))
      }
    }
  }
  ctx.json(HashMap<String, Any>().also {
    it["values"] = responses
  })
}

private fun parseTrailId(id: JsonNode):
    Pair<String, (statement: PreparedStatement, index: Int) -> Unit> {
  val idColumn: String
  val setId: (statement: PreparedStatement, index: Int) -> Unit
  if (id.has("numeric")) {
    idColumn = "ti.numeric_id"
    setId = { statement, index -> statement.setLong(index, id.get("numeric").asLong()) }
  } else if (id.has("readable")) {
    idColumn = "ti.readable_id"
    setId = { statement, index -> statement.setString(index, id.get("readable").asText()) }
  } else {
    throw IllegalArgumentException("Unknown type of trail ID")
  }
  return Pair(idColumn, setId)
}

private fun executeSearchBoundaries(rawQuery: String, limit: Int): Map<String, Any> {
  val data = ArrayList<HashMap<String, Any>>()
  val query = sanitizeQuery(rawQuery)
  val requiredBoundaries = HashSet<Long>();
  connectionSource.connection.use {
    it.createStatement().executeUpdate("SET pg_trgm.strict_word_similarity_threshold TO 0.2")
    val results = it.prepareStatement(
        "SELECT "
            + "sr.id, "
            + "sr.name, "
            + "sr.type, "
            + "ARRAY_REMOVE(ARRAY_AGG(bib.parent_id), NULL) "
            + "FROM ("
            + "  SELECT "
            + "    b.id as id, "
            + "    b.name as name, "
            + "    b.type as type, "
            + "    MAX(score) as score "
            + "  FROM ( "
            + "    SELECT id, name, type, length(name) / 1000. AS score "
            + "    FROM boundaries "
            + "    WHERE name ILIKE '%' || ? || '%' AND epoch = ? "
            + "    UNION ALL "
            + "    SELECT "
            + "      id, "
            + "      name, "
            + "      type, "
            + "      1 - strict_word_similarity(?, name) AS score "
            + "    FROM boundaries "
            + "    WHERE ? <<% name AND epoch = ? "
            + "  ) b "
            + "  WHERE score < 0.8 "
            + "  GROUP BY 1, 2, 3 "
            + "  ORDER BY MAX(score) ASC "
            + "  LIMIT ?"
            + ") sr "
            + "LEFT JOIN boundaries_in_boundaries bib ON sr.id = bib.child_id AND bib.epoch = ? "
            + "GROUP BY 1, 2, 3, sr.score "
            + "ORDER BY sr.score ASC")
        .apply {
          setString(1, query)
          setInt(2, epochTracker.epoch)
          setString(3, query)
          setString(4, query)
          setInt(5, epochTracker.epoch)
          setInt(6, limit)
          setInt(7, epochTracker.epoch)
        }.executeQuery()
    val seen = HashSet<Long>()
    while (results.next()) {
      val id = results.getLong(1)
      if (seen.contains(id)) {
        continue
      } else {
        seen.add(id)
      }

      val boundary = HashMap<String, Any>()
      boundary["id"] = id.toString()
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

private fun executeSearchTrails(rawQuery: String, limit: Int): Map<String, Any> {
  val data = ArrayList<HashMap<String, Any>>()
  val query = sanitizeQuery(rawQuery)
  val requiredBoundaries = HashSet<Long>();
  connectionSource.connection.use {
    it.createStatement().executeUpdate("SET pg_trgm.strict_word_similarity_threshold TO 0.3")
    val results = it.prepareStatement(
        "SELECT "
            + "sr.id, "
            + "sr.name, "
            + "sr.bound_degrees_e7, "
            + "sr.marker_degrees_e7, "
            + "sr.elevation_down_meters, "
            + "sr.elevation_up_meters, "
            + "sr.length_meters, "
            + "ARRAY_REMOVE(ARRAY_AGG(tib.boundary_id), NULL) "
            + "FROM ("
            + "  SELECT "
            + "    t.id as id, "
            + "    t.name as name, "
            + "    t.bound_degrees_e7, "
            + "    t.marker_degrees_e7 as marker_degrees_e7, "
            + "    t.elevation_down_meters as elevation_down_meters, "
            + "    t.elevation_up_meters as elevation_up_meters, "
            + "    t.length_meters as length_meters, "
            + "    MAX(score) as score "
            + "  FROM ( "
            + "    SELECT "
            + "      id, "
            + "      name, "
            + "      bound_degrees_e7, "
            + "      marker_degrees_e7, "
            + "      elevation_down_meters, "
            + "      elevation_up_meters, "
            + "      length_meters, "
            + "      length(name) / 1000. AS score "
            + "    FROM trails "
            + "    WHERE name ILIKE '%' || ? || '%' AND epoch = ? "
            + "    UNION ALL "
            + "    SELECT "
            + "      id, "
            + "      name, "
            + "      bound_degrees_e7, "
            + "      marker_degrees_e7, "
            + "      elevation_down_meters, "
            + "      elevation_up_meters, "
            + "      length_meters, "
            + "      1 - strict_word_similarity(?, name) AS score "
            + "    FROM trails "
            + "    WHERE ? <<% name AND epoch = ? "
            + "  ) t "
            + "  WHERE score < 0.7 "
            + "  GROUP BY 1, 2, 3, 4, 5, 6, 7 "
            + "  ORDER BY MAX(score) ASC "
            + "  LIMIT ?"
            + ") sr "
            + "LEFT JOIN trails_in_boundaries tib ON sr.id = tib.trail_id AND tib.epoch = ? "
            + "GROUP BY 1, 2, 3, 4, 5, 6, 7, sr.score "
            + "ORDER BY sr.score ASC")
        .apply {
          setString(1, query)
          setInt(2, epochTracker.epoch)
          setString(3, query)
          setString(4, query)
          setInt(5, epochTracker.epoch)
          setInt(6, limit)
          setInt(7, epochTracker.epoch)
        }.executeQuery()
    while (results.next()) {
      val trail = HashMap<String, Any>()
      trail["id"] = results.getLong(1).toString()
      trail["name"] = results.getString(2)
      trail["bound"] = String(Base64.getEncoder().encode(results.getBytes(3)))
      trail["marker"] = String(Base64.getEncoder().encode(results.getBytes(4)))
      trail["elevation_down_meters"] = results.getFloat(5)
      trail["elevation_up_meters"] = results.getFloat(6)
      trail["length_meters"] = results.getFloat(7)
      @Suppress("UNCHECKED_CAST")
      val boundaries = results.getArray(8).getArray() as Array<Long>
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
            + "b.name, "
            + "b.type "
            + "FROM boundaries b "
            + "WHERE b.id = ANY (?) AND epoch = ?")
        .apply {
          setArray(1, it.createArrayOf("BIGINT", requiredBoundaries.toArray()))
          setInt(2, epochTracker.epoch)
        }.executeQuery()
    while (results.next()) {
      boundaries[results.getLong(1).toString()] =
          ImmutableMap.of("name", results.getString(2), "type", results.getInt(3))
    }
  }
  return boundaries;
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

  val paths = ArrayList<WirePath>()
  connectionSource.connection.use {
    val query = if (cell.level() >= SimpleS2.HIGHEST_COARSE_INDEX_LEVEL) {
      it.prepareStatement(
          // Analysis shows that the union is faster than OR'ing the cell queries
          "SELECT p.id, p.type, p.lat_lng_degrees "
              + "FROM paths p "
              + "JOIN paths_in_trails pit "
              + "ON p.id = pit.path_id AND p.epoch = pit.epoch "
              + "WHERE "
              + "(p.cell >= ? AND p.cell <= ?) "
              + "AND p.epoch = ? "
      ).apply {
        val min = cell.rangeMin()
        val max = cell.rangeMax()
        setLong(1, min.id())
        setLong(2, max.id())
        setInt(3, epochTracker.epoch)
      }
    } else {
      it.prepareStatement(
          "SELECT p.id, p.type, p.lat_lng_degrees "
              + "FROM paths p "
              + "JOIN paths_in_trails pit "
              + "ON p.id = pit.path_id AND p.epoch = pit.epoch "
              + "WHERE "
              + "p.cell = ? "
              + "AND p.epoch = ? "
      ).apply {
        setLong(1, cell.id())
        setInt(2, epochTracker.epoch)
      }
    }
    val results = query.executeQuery()
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
  writeDetailPaths(paths, bytes, output)
  ctx.result(bytes.toByteArray())
}

private fun fetchFine(ctx: Context) {
  ctx.contentType("application/octet-stream")
  if (addETagAndCheckCached(ctx)) {
    return
  }

  val cell = S2CellId.fromToken(ctx.pathParam("token"))

  val paths = ArrayList<WirePath>()
  connectionSource.connection.use {
    val query = if (cell.level() >= SimpleS2.HIGHEST_FINE_INDEX_LEVEL) {
      it.prepareStatement(
          "SELECT p.id, p.type, p.lat_lng_degrees "
              + "FROM paths p "
              + "LEFT JOIN paths_in_trails pit "
              + "ON p.id = pit.path_id AND p.epoch = pit.epoch "
              + "WHERE "
              + "(p.cell >= ? AND p.cell <= ?) "
              + "AND p.epoch = ? "
              + "AND (pit.path_id IS NOT NULL OR public.enumADescendsB(p.type, ?, ?)) "
      ).apply {
        val min = cell.rangeMin()
        val max = cell.rangeMax()
        setLong(1, min.id())
        setLong(2, max.id())
        setInt(3, epochTracker.epoch)
        setInt(4, WayCategory.PATH.id)
        setInt(5, ENUM_SIZE)
      }
    } else {
      it.prepareStatement(
          "SELECT p.id, p.type, p.lat_lng_degrees "
              + "FROM paths p "
              + "LEFT JOIN paths_in_trails pit "
              + "ON p.id = pit.path_id AND p.epoch = pit.epoch "
              + "WHERE "
              + "p.cell = ? "
              + "AND p.epoch = ? "
              + "AND (pit.path_id IS NOT NULL OR public.enumADescendsB(p.type, ?, ?)) "
      ).apply {
        setLong(1, cell.id())
        setInt(2, epochTracker.epoch)
        setInt(3, WayCategory.PATH.id)
        setInt(4, ENUM_SIZE)
      }
    }
    val results = query.executeQuery()
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
    val query = if (cell.level() >= SimpleS2.HIGHEST_FINE_INDEX_LEVEL) {
      it.prepareStatement(
          "SELECT p.id, p.type, p.name, p.marker_degrees_e7 "
              + "FROM points p "
              + "WHERE "
              + "(p.cell >= ? AND p.cell <= ?) "
              + "AND p.epoch = ? "
      ).apply {
        val min = cell.rangeMin()
        val max = cell.rangeMax()
        setLong(1, min.id())
        setLong(2, max.id())
        setInt(3, epochTracker.epoch)
      }
    } else {
      it.prepareStatement(
          "SELECT p.id, p.type, p.name, p.marker_degrees_e7 "
              + "FROM points p "
              + "WHERE "
              + "p.cell = ? "
              + "AND p.epoch = ? "
      ).apply {
        setLong(1, cell.id())
        setInt(2, epochTracker.epoch)
      }
    }
    val results = query.executeQuery()
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
  writeDetailPaths(paths, bytes, output)
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
        "SELECT "
            + "id, "
            + "name, "
            + "type, "
            + "path_ids, "
            + "bound_degrees_e7, "
            + "marker_degrees_e7, "
            + "elevation_down_meters, "
            + "elevation_up_meters, "
            + "length_meters "
            + "FROM trails t "
            + "WHERE "
            + "t.id = ? "
            + "AND t.epoch = ? ").apply {
      setLong(1, trailId)
      setInt(2, epochTracker.epoch)
    }.executeQuery()

    if (!results.next()) {
      ctx.status(HttpStatus.NOT_FOUND)
      return@fetchDataPacked
    }

    WireTrail(
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
              vertices = results.getBytes(3).let {
                if (precise) it else simplify(it)
              }
          ))
    }
  }

  val bytes = AlignableByteArrayOutputStream()
  val output = DelegatingEncodedOutputStream(bytes)
  writeDetailPaths(paths, bytes, output)
  writeDetailTrails(listOf(trail), bytes, output)
  ctx.result(bytes.toByteArray())
}

private fun writeDetailPaths(
    paths: List<WirePath>,
    bytes: AlignableByteArrayOutputStream,
    output: DelegatingEncodedOutputStream) {
  output.writeVarInt(paths.size)
  for (path in paths) {
    output.writeVarLong(path.id)
    output.writeVarInt(path.type)
    output.writeVarInt(path.vertices.size / 4)
    output.flush()
    bytes.align(4)
    output.write(path.vertices)
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
  connectionSource.connection.use {
    val query = if (cell.level() >= bottom) {
      it.prepareStatement(
          "SELECT "
              + "id, "
              + "name, "
              + "type, "
              + "path_ids, "
              + "bound_degrees_e7, "
              + "marker_degrees_e7, "
              + "elevation_down_meters, "
              + "elevation_up_meters, "
              + "length_meters "
              + "FROM trails t "
              + "WHERE "
              + "(cell >= ? AND cell <= ?) "
              + "AND t.epoch = ? "
      ).apply {
        val min = cell.rangeMin()
        val max = cell.rangeMax()
        setLong(1, min.id())
        setLong(2, max.id())
        setInt(3, epochTracker.epoch)
      }
    } else {
      it.prepareStatement(
          "SELECT "
              + "id, "
              + "name, "
              + "type, "
              + "path_ids, "
              + "bound_degrees_e7, "
              + "marker_degrees_e7, "
              + "elevation_down_meters, "
              + "elevation_up_meters, "
              + "length_meters "
              + "FROM trails t "
              + "WHERE "
              + "t.cell = ? "
              + "AND t.epoch = ?"
      ).apply {
        setLong(1, cell.id())
        setInt(2, epochTracker.epoch)
      }
    }
    val results = query.executeQuery()
    while (results.next()) {
      trails.add(
          WireTrail(
              id = results.getLong(1),
              name = results.getString(2),
              type = results.getInt(3),
              pathIds = results.getBytes(4),
              bound = results.getBytes(5),
              marker = results.getBytes(6),
              elevationDownMeters = results.getFloat(7),
              elevationUpMeters = results.getFloat(8),
              lengthMeters = results.getFloat(9),
          ))
    }
  }
  return trails
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

private fun simplify(latLngDegrees: ByteArray): ByteArray {
  val degrees = ByteBuffer.wrap(latLngDegrees).order(ByteOrder.LITTLE_ENDIAN).asIntBuffer()
  val spans = Stack<Pair<Int, Int>>()
  spans.add(Pair(0, degrees.limit() / 2 - 1))
  val epsilon = 1 / 2.0.pow(17.0) // 1px at zoom level 17
  val points = ArrayList<Int>()
  while (spans.isNotEmpty()) {
    val (startI, endI) = spans.pop()
    if (startI == endI) {
      points.add(startI)
      continue
    }

    var biggestE = 0.0
    var furthest = -1
    val start = project(degrees[startI * 2], degrees[startI * 2 + 1])
    val end = project(degrees[endI * 2], degrees[endI * 2 + 1])
    val dx = end.first - start.first
    val dy = end.second - start.second
    val scale = 1.0 / sqrt(dx * dx + dy * dy)
    for (i in startI + 1  until endI) {
      val point = project(degrees[i * 2], degrees[i * 2 + 1])
      val dz = abs(dx * (start.second - point.second) - (start.first - point.first) * dy) * scale
      if (dz > epsilon && dz > biggestE) {
        biggestE = dz
        furthest = i
      }
    }

    if (furthest > -1) {
      spans.push(Pair(furthest, endI))
      spans.push(Pair(startI, furthest - 1))
    } else {
      points.add(startI)
      points.add(endI)
    }
  }

  val simplified = ByteBuffer.allocate(points.size * 2 * 4).order(ByteOrder.LITTLE_ENDIAN)
  simplified.asIntBuffer().let {
    for (i in points) {
      it.put(degrees.get(i * 2))
      it.put(degrees.get(i * 2 + 1))
    }
  }
  return simplified.array()
}

/** Projects into Mercator space from -1 to 1. */
private fun project(latDegrees: Int, lngDegrees: Int): Pair<Double, Double> {
  val x = lngDegrees / 10_000_000.0 / 180
  val latRadians = latDegrees / 10_000_000.0 / 180 * Math.PI
  val y = ln((1 + sin(latRadians)) / (1 - sin(latRadians))) / (2 * Math.PI)
  return Pair(x, y)
}

private fun sanitizeQuery(query: String): String {
  return query.replace("[%_\\]]", "")
}
