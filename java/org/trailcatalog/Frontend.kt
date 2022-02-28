package org.trailcatalog

import com.google.common.geometry.S2CellId
import com.google.common.io.LittleEndianDataOutputStream
import com.zaxxer.hikari.HikariConfig
import com.zaxxer.hikari.HikariDataSource
import io.javalin.Javalin
import io.javalin.http.Context
import java.io.ByteArrayOutputStream

val connectionSource = HikariDataSource(HikariConfig().apply {
  jdbcUrl =
    "jdbc:postgresql://10.110.231.203:5432/trailcatalog?currentSchema=migration_2_add_route_point"
  username = "postgres"
  password = "postgres"
})

fun main(args: Array<String>) {
  val app = Javalin.create {}.start(7070)
  app.get("/api/fetch_cell/{token}", ::fetchCell)
}

data class WireRoute(
  val id: Long,
  val name: String,
  val type: Int,
  val highways: LongArray,
  val x: Double,
  val y: Double,
)
data class WireWay(val id: Long, val type: Int, val routes: LongArray, val vertices: ByteArray)

fun fetchCell(ctx: Context) {
  ctx.contentType("application/octet-stream")

  val cell = S2CellId.fromToken(ctx.pathParam("token"))
  val routes = ArrayList<WireRoute>()
  connectionSource.connection.use {
    val query = it.prepareStatement("SELECT id, name, type, highways, x, y FROM routes WHERE cell = ?").apply {
      setLong(1, cell.id())
    }
    val results = query.executeQuery()
    while (results.next()) {
      routes.add(WireRoute(
          id = results.getLong(1),
          name = results.getString(2),
          type = results.getInt(3),
          highways = results.getArray(4).resultSet.use {
            val longs = ArrayList<Long>()
            while (it.next()) {
              longs.add(it.getLong(2))
            }
            longs.toLongArray()
          },
          x = results.getDouble(5),
          y = results.getDouble(6),
      ))
    }
  }

  val ways = ArrayList<WireWay>()
  connectionSource.connection.use {
    val query = it.prepareStatement("SELECT id, type, routes, mercator_doubles FROM highways WHERE cell = ?").apply {
      setLong(1, cell.id())
    }
    val results = query.executeQuery()
    while (results.next()) {
      ways.add(WireWay(
          id = results.getLong(1),
          type = results.getInt(2),
          routes = results.getArray(3).resultSet.use {
            val longs = ArrayList<Long>()
            while (it.next()) {
              longs.add(it.getLong(2))
            }
            longs.toLongArray()
          },
          vertices = results.getBytes(4),
      ))
    }
  }

  val bytes = AlignableByteArrayOutputStream()
  val output = LittleEndianDataOutputStream(bytes)
  output.writeInt(ways.size)
  for (way in ways) {
    output.writeLong(way.id)
    output.writeInt(way.type)
    output.writeInt(way.routes.size)
    for (route in way.routes) {
      output.writeLong(route)
    }
    output.writeInt(way.vertices.size)
    output.flush()
    bytes.align(8)
    output.write(way.vertices)
  }
  output.writeInt(routes.size)
  for (route in routes) {
    output.writeLong(route.id)
    val asUtf8 = route.name.toByteArray(Charsets.UTF_8)
    output.writeInt(asUtf8.size)
    output.write(asUtf8)
    output.writeInt(route.type)
    output.writeInt(route.highways.size)
    output.flush()
    bytes.align(8)
    for (way in route.highways) {
      output.writeLong(way)
    }
    output.writeDouble(route.x)
    output.writeDouble(route.y)
  }
  ctx.result(bytes.toByteArray())
}

class AlignableByteArrayOutputStream : ByteArrayOutputStream() {

  fun align(alignment: Int) {
    count = (count + alignment - 1) / alignment * alignment
    // No need to grow because the next write will catch up
  }
}