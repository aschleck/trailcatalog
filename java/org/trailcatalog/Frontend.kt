package org.trailcatalog

import com.google.common.base.Joiner
import com.google.common.geometry.S2CellId
import com.google.common.geometry.S2LatLng
import com.google.devtools.build.runfiles.Runfiles
import io.javalin.Javalin
import io.javalin.http.Context
import java.sql.DriverManager
import org.eclipse.jetty.server.handler.ContextHandler

fun main(args: Array<String>) {
  val connection =
      DriverManager.getConnection(
          "jdbc:postgresql://10.110.231.203:5432/trailcatalog",
          "postgres",
          "postgres")

  val runfiles = Runfiles.create()
  val app = Javalin.create {}.start(7070)
  app.get("/api/fetch_cell", ::map)
}

fun map(ctx: Context) {

  val cell =
      S2CellId
          .fromLatLng(S2LatLng.fromDegrees(37.383711, -122.174580))
          .parent(18)
  val neighbors = ArrayList<S2CellId>()
  cell.getAllNeighbors(18, neighbors)
  ctx.result("Cells: " + Joiner.on(", ").join(neighbors))
}
