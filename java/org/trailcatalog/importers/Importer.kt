package org.trailcatalog.importers

import org.postgresql.jdbc.PgConnection
import org.trailcatalog.createConnectionSource
import java.lang.IllegalArgumentException

fun main(args: Array<String>) {
  var pbf = ""
  var immediatelyBucketPaths = true
  var importOsmFeatures = true
  var importTcFeatures = true
  var fillTcRelations = true
  var fillInGeometry = true

  for (arg in args) {
    val (option, value) = arg.split("=")
    when (option) {
      "--pbf" -> pbf = value
      "--fill_in_geometry" -> fillInGeometry = value.toBooleanStrict()
      "--fill_tc_relations" -> fillTcRelations = value.toBooleanStrict()
      "--immediately_bucket_paths" -> immediatelyBucketPaths = value.toBooleanStrict()
      "--import_osm" -> importOsmFeatures = value.toBooleanStrict()
      "--import_tc" -> importTcFeatures = value.toBooleanStrict()
      else -> throw IllegalArgumentException("Unknown argument ${option}")
    }
  }

  if ((importOsmFeatures || importTcFeatures) && pbf.isBlank()) {
    throw IllegalArgumentException("Must specify --pbf")
  }

  createConnectionSource(syncCommit = false).use { hikari ->
    hikari.connection.use {
      val pg = it.unwrap(PgConnection::class.java)
      pg.autoCommit = false

      if (importOsmFeatures) {
        importOsmFromPbf(pg, pbf)
      }

      if (importTcFeatures) {
        seedFromPbf(pg, immediatelyBucketPaths, fillTcRelations, pbf)
      }

      pg.autoCommit = true
    }

    if (fillInGeometry) {
      fillInGeometry(hikari)
    }
  }
}