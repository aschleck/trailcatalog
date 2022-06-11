package org.trailcatalog

import com.google.common.geometry.S2CellId
import com.google.common.io.LittleEndianDataOutputStream
import io.javalin.Javalin
import io.javalin.http.Context
import org.trailcatalog.s2.SimpleS2
import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.ln
import kotlin.math.sin

val connectionSource = createConnectionSource()
val epochTracker = EpochTracker(connectionSource)

fun main(args: Array<String>) {
  val app = Javalin.create {}.start(7070)
  app.get("/api/fetch_metadata/{token}", ::fetchMeta)
  app.get("/api/fetch_detail/{token}", ::fetchDetail)
}

data class WireBoundary(val id: Long, val type: Int, val name: String)

data class WirePath(val id: Long, val type: Int, val vertices: ByteArray)

data class WireTrail(
  val id: Long,
  val name: String,
  val type: Int,
  val pathIds: ByteArray,
  val x: Double,
  val y: Double,
  val lengthMeters: Double,
)

fun fetchMeta(ctx: Context) {
  ctx.contentType("application/octet-stream")

  val cell = S2CellId.fromToken(ctx.pathParam("token"))
  val boundary = try {
    ctx.queryParam("boundary")?.toLong()
  } catch (e: NumberFormatException) {
    throw IllegalArgumentException("Invalid boundary")
  }

  val trails =
      fetchTrails(
          cell, SimpleS2.HIGHEST_METADATA_INDEX_LEVEL, /* includePaths= */ false, boundary)
  val bytes = AlignableByteArrayOutputStream()
  val output = LittleEndianDataOutputStream(bytes)

  output.writeInt(trails.size)
  for (trail in trails) {
    output.writeLong(trail.id)
    val asUtf8 = trail.name.toByteArray(Charsets.UTF_8)
    output.writeInt(asUtf8.size)
    output.write(asUtf8)
    output.writeInt(trail.type)
    output.writeDouble(trail.x)
    output.writeDouble(trail.y)
    output.writeDouble(trail.lengthMeters)
  }
  ctx.result(bytes.toByteArray())
}

fun fetchDetail(ctx: Context) {
  ctx.contentType("application/octet-stream")

  val cell = S2CellId.fromToken(ctx.pathParam("token"))
  val boundary = try {
    ctx.queryParam("boundary")?.toLong()
  } catch (e: NumberFormatException) {
    throw IllegalArgumentException("Invalid boundary")
  }

  val paths = HashMap<Long, WirePath>()
  connectionSource.connection.use {
    val query = if (cell.level() >= SimpleS2.HIGHEST_DETAIL_INDEX_LEVEL) {
      it.prepareStatement(
          "SELECT p.id, p.type, p.lat_lng_degrees "
              + "FROM paths p "
              + "JOIN paths_in_trails pit ON p.id = pit.path_id AND p.epoch = pit.epoch "
              + "WHERE "
              + "((p.cell >= ? AND p.cell <= ?) OR (p.cell >= ? AND p.cell <= ?))"
              + "AND p.epoch = ? "
      ).apply {
        val min = cell.rangeMin()
        val max = cell.rangeMax()
        setLong(1, min.id())
        setLong(2, max.id())
        setLong(3, min.id() + Long.MIN_VALUE)
        setLong(4, max.id() + Long.MIN_VALUE)
        setInt(5, epochTracker.epoch)
      }
    } else {
      it.prepareStatement(
          "SELECT p.id, p.type, p.lat_lng_degrees "
              + "FROM paths p "
              + "JOIN paths_in_trails pit ON p.id = pit.path_id AND p.epoch = pit.epoch "
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
      if (!paths.containsKey(id)) {
        paths[id] = WirePath(
            id = id,
            type = results.getInt(2),
            vertices = project(results.getBytes(3)),
        )
      }
    }
  }

  val trails = fetchTrails(cell, SimpleS2.HIGHEST_DETAIL_INDEX_LEVEL, /* includePaths= */ true, boundary)
  val bytes = AlignableByteArrayOutputStream()
  val output = LittleEndianDataOutputStream(bytes)

  output.writeInt(paths.size)
  for (path in paths.values) {
    output.writeLong(path.id)
    output.writeInt(path.type)
    output.writeInt(path.vertices.size)
    output.flush()
    bytes.align(4)
    output.write(path.vertices)
  }

  output.writeInt(trails.size)
  for (trail in trails) {
    output.writeLong(trail.id)
    val asUtf8 = trail.name.toByteArray(Charsets.UTF_8)
    output.writeInt(asUtf8.size)
    output.write(asUtf8)
    output.writeInt(trail.type)
    output.writeInt(trail.pathIds.size / 8)
    output.flush()
    bytes.align(8)
    output.write(trail.pathIds)
    output.writeDouble(trail.x)
    output.writeDouble(trail.y)
    output.writeDouble(trail.lengthMeters)
  }

  ctx.result(bytes.toByteArray())
}

private fun fetchTrails(cell: S2CellId, bottom: Int, includePaths: Boolean, boundary: Long?): List<WireTrail> {
  val trails = ArrayList<WireTrail>()
  connectionSource.connection.use {
    val query = if (cell.level() >= bottom) {
      it.prepareStatement(
          "SELECT "
              + "id, "
              + "name, "
              + "type, "
              + (if (includePaths) "path_ids, " else "")
              + "center_lat_degrees, "
              + "center_lng_degrees, "
              + "length_meters "
              + "FROM trails t "
              + (if (boundary != null) "JOIN trails_in_boundaries tib ON t.id = tib.trail_id " else "")
              + "WHERE "
              + "((cell >= ? AND cell <= ?) OR (cell >= ? AND cell <= ?)) "
              + "AND t.epoch = ?"
              + (if (boundary != null) "AND tib.boundary_id = ?" else "")).apply {
        val min = cell.rangeMin()
        val max = cell.rangeMax()
        setLong(1, min.id())
        setLong(2, max.id())
        setLong(3, min.id() + Long.MIN_VALUE)
        setLong(4, max.id() + Long.MIN_VALUE)
        setInt(5, epochTracker.epoch)
        if (boundary != null) {
          setLong(6, boundary)
        }
      }
    } else {
      it.prepareStatement(
          "SELECT "
              + "id, "
              + "name, "
              + "type, "
              + (if (includePaths) "path_ids, " else "")
              + "center_lat_degrees, "
              + "center_lng_degrees, "
              + "length_meters "
              + "FROM trails t "
              + (if (boundary != null) "JOIN trails_in_boundaries tib ON t.id = tib.trail_id " else "")
              + "WHERE "
              + "t.cell = ? "
              + "AND t.epoch = ? "
              + (if (boundary != null) "AND tib.boundary_id = ?" else "")).apply {
        setLong(1, cell.id())
        setInt(2, epochTracker.epoch)
        if (boundary != null) {
          setLong(3, boundary)
        }
      }
    }
    val results = query.executeQuery()
    while (results.next()) {
      val pathOffset = if (includePaths) 1 else 0
      val projected =
          project(
              results.getInt(4 + pathOffset) / 10_000_000.0,
              results.getInt(5 + pathOffset) / 10_000_000.0)

      trails.add(
          WireTrail(
              id = results.getLong(1),
              name = results.getString(2),
              type = results.getInt(3),
              pathIds = if (includePaths) results.getBytes(4) else byteArrayOf(),
              x = projected.first,
              y = projected.second,
              lengthMeters = results.getDouble(6 + pathOffset),
          ))
    }
  }
  return trails
}

class AlignableByteArrayOutputStream : ByteArrayOutputStream() {

  fun align(alignment: Int) {
    count = (count + alignment - 1) / alignment * alignment
    // No need to grow because the next write will catch up
  }
}

private fun project(latLngDegrees: ByteArray): ByteArray {
  val degrees = ByteBuffer.wrap(latLngDegrees).order(ByteOrder.LITTLE_ENDIAN).asIntBuffer()
  val projected = ByteBuffer.allocate(latLngDegrees.size).order(ByteOrder.LITTLE_ENDIAN)
  projected.asFloatBuffer().let {
    for (i in (0 until it.capacity()).step(2)) {
      // TODO(april): I think we get better precision with int E7 so we should probably do the
      // double projection clientside instead.
      val mercator = project(degrees.get(i) / 10_000_000.0, degrees.get(i + 1) / 10_000_000.0)
      it.put(i, mercator.first.toFloat())
      it.put(i + 1, mercator.second.toFloat())
    }
  }
  return projected.array()
}

/** Projects into Mercator space from -1 to 1. */
private fun project(latDegrees: Double, lngDegrees: Double): Pair<Double, Double> {
  val x = lngDegrees / 180
  val latRadians = latDegrees / 180 * Math.PI
  val y = ln((1 + sin(latRadians)) / (1 - sin(latRadians))) / (2 * Math.PI)
  return Pair(x, y)
}
