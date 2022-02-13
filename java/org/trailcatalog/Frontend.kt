package org.trailcatalog

import com.google.common.geometry.S2CellId
import com.google.devtools.build.runfiles.Runfiles
import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import io.javalin.Javalin
import io.javalin.http.Context
import java.sql.DriverManager

val connectionSource = HikariDataSource(HikariConfig())

fun main(args: Array<String>) {
  val connection =
      DriverManager.getConnection(
          "jdbc:postgresql://10.110.231.203:5432/trailcatalog",
          "postgres",
          "postgres")

  val runfiles = Runfiles.create()
  val app = Javalin.create {}.start(7070)
  app.get("/api/fetch_cell/{token}", ::fetch_cell)
}

fun fetch_cell(ctx: Context) {
  val cell = S2CellId.fromToken(ctx.pathParam("token"));
  ctx.result("Cell: " + cell)
}
