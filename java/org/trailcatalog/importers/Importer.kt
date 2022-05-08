package org.trailcatalog.importers

import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.ResponseBody
import org.postgresql.jdbc.PgConnection
import org.trailcatalog.createConnectionSource
import java.lang.IllegalArgumentException
import java.lang.RuntimeException
import java.nio.charset.StandardCharsets
import java.nio.file.Path
import kotlin.io.path.name
import kotlin.io.path.outputStream

fun main(args: Array<String>) {
  // path is like north-america/us/washington
  var geofabrikPath = ""
  var immediatelyBucketPaths = true
  var importOsmFeatures = true
  var importTcFeatures = true
  var fillTcRelations = true
  var fillInGeometry = true

  for (arg in args) {
    val (option, value) = arg.split("=")
    when (option) {
      "--geofabrik_path" -> geofabrikPath = value
      "--fill_in_geometry" -> fillInGeometry = value.toBooleanStrict()
      "--fill_tc_relations" -> fillTcRelations = value.toBooleanStrict()
      "--immediately_bucket_paths" -> immediatelyBucketPaths = value.toBooleanStrict()
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
          pg.prepareStatement(
              "INSERT INTO geofabrik_sources (path, current_sequence_number) VALUES (?, ?)").use {
            it.setString(1, geofabrikPath)
            it.setInt(2, sequenceNumber)
            it.execute()
          }
          pg.commit()

          importOsmFromPbf(pg, pbf.toString())
        }

        if (importTcFeatures) {
          seedFromPbf(pg, immediatelyBucketPaths, fillTcRelations, pbf.toString())
        }
      }

      pg.autoCommit = true
    }

    if (fillInGeometry) {
      fillInGeometry(hikari)
    }
  }
}
