package org.trailcatalog.importers

import org.postgresql.jdbc.PgConnection
import org.trailcatalog.createConnectionSource
import java.lang.IllegalArgumentException

fun main(args: Array<String>) {
  var pbf = ""
  var importOsmFeatures = true
  var importTcFeatures = true
  var fillInGeometry = true
  for (arg in args) {
    val (option, value) = arg.split("=")
    when (option) {
      "--pbf" -> pbf = value
      "--import_osm" -> importOsmFeatures = value.toBooleanStrict()
      "--import_tc" -> importTcFeatures = value.toBooleanStrict()
      "--fill_in_geometry" -> fillInGeometry = value.toBooleanStrict()
    }
  }

  if ((importOsmFeatures || importTcFeatures) && pbf.isBlank()) {
    throw IllegalArgumentException("Must specify --pbf")
  }

  createConnectionSource(maxSize = 64, syncCommit = false).use { hikari ->
    hikari.connection.use {
      val pg = it.unwrap(PgConnection::class.java)
      pg.autoCommit = false

      if (importOsmFeatures) {
        importOsmFromPbf(pg, pbf)
      }

      if (importTcFeatures) {
        seedFromPbf(pg, pbf)
      }

      pg.autoCommit = true
    }

    if (fillInGeometry) {
      fillInGeometry(hikari)
    }
  }
}