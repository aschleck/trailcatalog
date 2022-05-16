package org.trailcatalog.importers

import okhttp3.HttpUrl.Companion.toHttpUrl
import org.postgresql.jdbc.PgConnection
import org.trailcatalog.createConnectionSource
import java.lang.IllegalArgumentException
import java.nio.file.Path

fun main(args: Array<String>) {
  // path is like north-america/us/washington
  var geofabrikPath = ""
  var importOsmFeatures = true
  var importTcFeatures = true
  var fillInContainment = true
  var fillInGeometry = true

  for (arg in args) {
    val (option, value) = arg.split("=")
    when (option) {
      "--geofabrik_path" -> geofabrikPath = value
      "--fill_in_containment" -> fillInContainment = value.toBooleanStrict()
      "--fill_in_geometry" -> fillInGeometry = value.toBooleanStrict()
      "--import_osm" -> importOsmFeatures = value.toBooleanStrict()
      "--import_tc" -> importTcFeatures = value.toBooleanStrict()
      else -> throw IllegalArgumentException("Unknown argument ${option}")
    }
  }

  createConnectionSource(syncCommit = false).use { hikari ->
    hikari.connection.use {
      val pg = it.unwrap(PgConnection::class.java)
      pg.autoCommit = false

      if (importOsmFeatures || importTcFeatures) {
        if (geofabrikPath.isBlank()) {
          throw IllegalArgumentException("Must specify --geofabrik_path")
        }

        val pbfUrl = "https://download.geofabrik.de/${geofabrikPath}-latest.osm.pbf".toHttpUrl()
        val pbf = Path.of("pbfs", pbfUrl.pathSegments[pbfUrl.pathSize - 1])

        if (importOsmFeatures) {
          val sequenceNumber =
            getSequence(
                "https://download.geofabrik.de/${geofabrikPath}-updates/state.txt".toHttpUrl())
          download(pbfUrl, pbf)
          val currentSequence =
            pg.prepareStatement(
                "SELECT current_sequence_number FROM geofabrik_sources WHERE path = ?").apply {
              setString(1, geofabrikPath)
            }.use {
              it.executeQuery().use {
                if (it.next()) {
                  it.getInt(1)
                } else {
                  null
                }
              }
            }
          if (currentSequence != null && currentSequence != sequenceNumber) {
            throw IllegalStateException("Existing data is at a different sequence, can't reimport")
          } else if (currentSequence == null) {
            pg.prepareStatement(
                "INSERT INTO geofabrik_sources (path, current_sequence_number) VALUES (?, ?)").use {
              it.setString(1, geofabrikPath)
              it.setInt(2, sequenceNumber)
              it.execute()
            }
            pg.commit()
          }

          importOsmFromPbf(pg, pbf.toString())
        }

        if (importTcFeatures) {
          seedFromPbf(pg, pbf.toString())
        }
      }

      pg.autoCommit = true
    }

    if (fillInGeometry) {
      fillInGeometry(hikari)
    }

    if (fillInContainment) {
      hikari.connection.use {
        fillBoundaryContainments(it)
        fillTrailContainments(it)
      }
    }
  }
}
