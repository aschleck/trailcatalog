package org.trailcatalog

import com.google.common.geometry.S2CellId
import com.google.common.io.LittleEndianDataOutputStream
import io.javalin.Javalin
import io.javalin.http.Context
import org.trailcatalog.models.TrailVisibility
import org.trailcatalog.s2.SimpleS2
import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.ln
import kotlin.math.sin

val connectionSource = createConnectionSource()

fun main(args: Array<String>) {
  val app = Javalin.create {}.start(7070)
  app.get("/api/fetch_metadata/{token}", ::fetchMeta)
  app.get("/api/fetch_detail/{token}", ::fetchDetail)
}

data class WireBoundary(val id: Long, val type: Int, val name: String)

data class WirePath(val id: Long, val type: Int, val trails: MutableList<Long>, val vertices: ByteArray)

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

//  val boundaries = ArrayList<WireBoundary>()
//  connectionSource.connection.use {
//    val query = if (cell.level() >= 12) {
//      it.prepareStatement(
//          "SELECT id, name, type "
//              + "FROM boundaries "
//              + "WHERE "
//              + "((cell >= ? AND cell <= ?) OR (cell >= ? AND cell <= ?))").apply {
//        val min = cell.rangeMin()
//        val max = cell.rangeMax()
//        setLong(1, min.id())
//        setLong(2, max.id())
//        setLong(3, min.id() + Long.MIN_VALUE)
//        setLong(4, max.id() + Long.MIN_VALUE)
//      }
//    } else {
//      it.prepareStatement(
//          "SELECT id, name, type "
//              + "FROM boundaries "
//              + "WHERE "
//              + "cell = ?").apply {
//        setLong(1, cell.id())
//      }
//    }
//    val results = query.executeQuery()
//    while (results.next()) {
//      boundaries.add(WireBoundary(
//          id = results.getLong(1),
//          name = results.getString(2),
//          type = results.getInt(3),
//      ))
//    }
//  }

  val trails = ArrayList<WireTrail>()
  connectionSource.connection.use {
    val query = if (cell.level() >= SimpleS2.HIGHEST_METADATA_INDEX_LEVEL) {
      it.prepareStatement(
          "SELECT id, name, type, center_lat_degrees, center_lng_degrees, length_meters "
              + "FROM trails "
              + "WHERE "
              + "((cell >= ? AND cell <= ?) OR (cell >= ? AND cell <= ?)) "
              + "AND visibility = ${TrailVisibility.VISIBLE.id}").apply {
        val min = cell.rangeMin()
        val max = cell.rangeMax()
        setLong(1, min.id())
        setLong(2, max.id())
        setLong(3, min.id() + Long.MIN_VALUE)
        setLong(4, max.id() + Long.MIN_VALUE)
      }
    } else {
      it.prepareStatement(
          "SELECT id, name, type, center_lat_degrees, center_lng_degrees, length_meters "
              + "FROM trails "
              + "WHERE "
              + "cell = ? AND visibility = ${TrailVisibility.VISIBLE.id}").apply {
        setLong(1, cell.id())
      }
    }
    val results = query.executeQuery()
    while (results.next()) {
      val projected = project(results.getDouble(4), results.getDouble(5))

      trails.add(WireTrail(
          id = results.getLong(1),
          name = results.getString(2),
          type = results.getInt(3),
          pathIds = byteArrayOf(),
          x = projected.first,
          y = projected.second,
          lengthMeters = results.getDouble(6),
      ))
    }
  }

  val bytes = AlignableByteArrayOutputStream()
  val output = LittleEndianDataOutputStream(bytes)
//  output.writeInt(boundaries.size)
//  for (boundary in boundaries) {
//    output.writeLong(boundary.id)
//    output.writeInt(boundary.type)
//    val asUtf8 = boundary.name.toByteArray(Charsets.UTF_8)
//    output.writeInt(asUtf8.size)
//    output.write(asUtf8)
//  }

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

  val paths = HashMap<Long, WirePath>()
  connectionSource.connection.use {
    val query = if (cell.level() >= SimpleS2.HIGHEST_DETAIL_INDEX_LEVEL) {
      it.prepareStatement(
          "SELECT p.id, p.type, p.lat_lng_degrees, pit.trail_id "
              + "FROM paths p "
              + "JOIN paths_in_trails pit ON p.id = pit.path_id "
              + "JOIN trails t ON pit.trail_id = t.id "
              + "WHERE "
              + "((p.cell >= ? AND p.cell <= ?) OR (p.cell >= ? AND p.cell <= ?)) "
              + "AND t.visibility = ${TrailVisibility.VISIBLE.id}").apply {
        val min = cell.rangeMin()
        val max = cell.rangeMax()
        setLong(1, min.id())
        setLong(2, max.id())
        setLong(3, min.id() + Long.MIN_VALUE)
        setLong(4, max.id() + Long.MIN_VALUE)
      }
    } else {
      it.prepareStatement(
          "SELECT p.id, p.type, p.lat_lng_degrees, pit.trail_id "
              + "FROM paths p "
              + "JOIN paths_in_trails pit ON p.id = pit.path_id "
              + "JOIN trails t ON pit.trail_id = t.id "
              + "WHERE p.cell = ? AND t.visibility = ${TrailVisibility.VISIBLE.id}").apply {
        setLong(1, cell.id())
      }
    }
    val results = query.executeQuery()
    while (results.next()) {
      val id = results.getLong(1)
      if (!paths.containsKey(id)) {
        paths[id] = WirePath(
            id = id,
            type = results.getInt(2),
            trails = ArrayList(),
            vertices = project(results.getBytes(3)),
        )
      }
      paths[id]!!.trails.add(results.getLong(4))
    }
  }

  val trails = ArrayList<WireTrail>()
  connectionSource.connection.use {
    val query = if (cell.level() >= SimpleS2.HIGHEST_DETAIL_INDEX_LEVEL) {
      it.prepareStatement(
          "SELECT id, name, type, path_ids, center_lat_degrees, center_lng_degrees, length_meters "
              + "FROM trails "
              + "WHERE "
              + "((cell >= ? AND cell <= ?) OR (cell >= ? AND cell <= ?)) "
              + "AND visibility = ${TrailVisibility.VISIBLE.id}").apply {
        val min = cell.rangeMin()
        val max = cell.rangeMax()
        setLong(1, min.id())
        setLong(2, max.id())
        setLong(3, min.id() + Long.MIN_VALUE)
        setLong(4, max.id() + Long.MIN_VALUE)
      }
    } else {
      it.prepareStatement(
          "SELECT id, name, type, path_ids, center_lat_degrees, center_lng_degrees, length_meters "
              + "FROM trails "
              + "WHERE "
              + "cell = ? AND visibility = ${TrailVisibility.VISIBLE.id}").apply {
        setLong(1, cell.id())
      }
    }
    val results = query.executeQuery()
    while (results.next()) {
      val projected = project(results.getDouble(5), results.getDouble(6))

      trails.add(WireTrail(
          id = results.getLong(1),
          name = results.getString(2),
          type = results.getInt(3),
          pathIds = results.getBytes(4),
          x = projected.first,
          y = projected.second,
          lengthMeters = results.getDouble(7),
      ))
    }
  }

  val bytes = AlignableByteArrayOutputStream()
  val output = LittleEndianDataOutputStream(bytes)

  output.writeInt(paths.size)
  for (path in paths.values) {
    output.writeLong(path.id)
    output.writeInt(path.type)
    output.writeInt(path.trails.size)
    for (trail in path.trails) {
      output.writeLong(trail)
    }
    output.writeInt(path.vertices.size)
    output.flush()
    bytes.align(8)
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

class AlignableByteArrayOutputStream : ByteArrayOutputStream() {

  fun align(alignment: Int) {
    count = (count + alignment - 1) / alignment * alignment
    // No need to grow because the next write will catch up
  }
}

private fun project(latLngDegrees: ByteArray): ByteArray {
  val degrees = ByteBuffer.wrap(latLngDegrees).order(ByteOrder.LITTLE_ENDIAN).asDoubleBuffer()
  val projected = ByteBuffer.allocate(latLngDegrees.size).order(ByteOrder.LITTLE_ENDIAN)
  projected.asDoubleBuffer().let {
    for (i in (0 until it.capacity()).step(2)) {
      val mercator = project(degrees.get(i), degrees.get(i + 1))
      it.put(i, mercator.first)
      it.put(i + 1, mercator.second)
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

