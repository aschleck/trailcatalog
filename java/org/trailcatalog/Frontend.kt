package org.trailcatalog

import com.google.common.collect.ArrayListMultimap
import com.google.common.geometry.S2CellId
import com.google.common.geometry.S2LatLng
import com.google.common.io.LittleEndianDataOutputStream
import com.zaxxer.hikari.HikariConfig
import com.zaxxer.hikari.HikariDataSource
import io.javalin.Javalin
import io.javalin.http.Context
import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.ln
import kotlin.math.sin

val connectionSource = HikariDataSource(HikariConfig().apply {
  jdbcUrl =
    "jdbc:postgresql://10.110.231.203:5432/trailcatalog?currentSchema=migration_1_create_geometry"
  username = "postgres"
  password = "postgres"
})

fun main(args: Array<String>) {
  val app = Javalin.create {}.start(7070)
  app.get("/api/fetch_cell/{token}", ::fetchCell)
}

data class WireTrail(
  val id: Long,
  val name: String,
  val type: Int,
  val pathIds: ByteArray,
  val x: Double,
  val y: Double,
  val lengthMeters: Double,
)
data class WirePath(val id: Long, val type: Int, val trails: List<Long>, val vertices: ByteArray)

fun fetchCell(ctx: Context) {
  ctx.contentType("application/octet-stream")

  val cell = S2CellId.fromToken(ctx.pathParam("token"))

  val pathsToTrails = ArrayListMultimap.create<Long, Long>()
  connectionSource.connection.use {
    val query =
      it.prepareStatement(
          "SELECT pit.path_id, pit.trail_id "
              + "FROM paths p "
              + "JOIN paths_in_trails pit ON pit.path_id = p.id "
              + "WHERE p.cell = ?").apply {
        setLong(1, cell.id())
      }
    val results = query.executeQuery()
    while (results.next()) {
      val pathId = results.getLong(1)
      val trailId = results.getLong(2)
      pathsToTrails.put(pathId, trailId)
    }
  }

  val trails = ArrayList<WireTrail>()
  connectionSource.connection.use {
    val query = it.prepareStatement(
        "SELECT id, name, type, path_ids, center_lat_degrees, center_lng_degrees, length_meters "
            + "FROM trails "
            + "WHERE cell = ?").apply {
      setLong(1, cell.id())
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

  val ways = ArrayList<WirePath>()
  connectionSource.connection.use {
    val query = it.prepareStatement(
        "SELECT id, type, lat_lng_degrees FROM paths WHERE cell = ?").apply {
      setLong(1, cell.id())
    }
    val results = query.executeQuery()
    while (results.next()) {
      val id = results.getLong(1)
      ways.add(WirePath(
          id = id,
          type = results.getInt(2),
          trails = pathsToTrails.get(id),
          vertices = project(results.getBytes(3)),
      ))
    }
  }

  val bytes = AlignableByteArrayOutputStream()
  val output = LittleEndianDataOutputStream(bytes)
  output.writeInt(ways.size)
  for (way in ways) {
    output.writeLong(way.id)
    output.writeInt(way.type)
    output.writeInt(way.trails.size)
    for (trail in way.trails) {
      output.writeLong(trail)
    }
    output.writeInt(way.vertices.size)
    output.flush()
    bytes.align(8)
    output.write(way.vertices)
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

