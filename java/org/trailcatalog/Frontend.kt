package org.trailcatalog

import com.google.common.geometry.S2CellId
import com.google.common.geometry.S2LatLngRect
import com.google.common.primitives.UnsignedLongs
import com.google.devtools.build.runfiles.Runfiles
import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import io.javalin.Javalin
import io.javalin.core.util.Headers
import io.javalin.http.Context
import java.io.ByteArrayOutputStream
import java.io.DataOutputStream
import java.sql.DriverManager

val connectionSource = HikariDataSource(HikariConfig().apply {
  jdbcUrl =
    "jdbc:postgresql://10.110.231.203:5432/trailcatalog?currentSchema=migration_1_create_geometry"
  username = "postgres"
  password = "postgres"
})

fun main(args: Array<String>) {
  val app = Javalin.create {}.start(7070)
  app.get("/api/fetch_cell/{token}", ::fetch_cell)
}

data class WireWay(val id: Long, val type: Int, val vertices: ByteArray)

fun fetch_cell(ctx: Context) {
  ctx.contentType("application/octet-stream")
  val cell = S2CellId.fromToken(ctx.pathParam("token"))
  val ways = ArrayList<WireWay>()
  connectionSource.connection.use {
    val query = it.prepareStatement("SELECT id, type, points_bytes FROM ways WHERE cell = ?").apply {
      setLong(1, cell.id())
    }
    val results = query.executeQuery()
    while (results.next()) {
      ways.add(WireWay(
          id = results.getLong(1),
          type = results.getInt(2),
          vertices = results.getBytes(3),
      ))
    }
  }

  val bytes = ByteArrayOutputStream()
  val output = DataOutputStream(bytes)
  output.writeInt(ways.size)
  for (way in ways) {
    output.writeLong(way.id)
    output.writeInt(way.type)
    output.writeInt(way.vertices.size)
  }
  for (way in ways) {
    output.write(way.vertices)
  }
  ctx.result(bytes.toByteArray())
}
