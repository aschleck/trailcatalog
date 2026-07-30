package org.trailcatalog.importers.basemap

import com.zaxxer.hikari.HikariDataSource
import org.apache.commons.text.StringEscapeUtils
import org.trailcatalog.importers.pipeline.PSink
import org.trailcatalog.importers.pipeline.collections.PCollection

class DumpTrailNames(private val epoch: Int, private val hikari: HikariDataSource)
  : PSink<PCollection<Trail>>() {

  override fun write(input: PCollection<Trail>) {
    input.use {
      val stream =
          StringifyingInputStream(input) { trail, csv ->
            for (name in trail.names) {
              // id,epoch,language,name
              csv.append(trail.relationId)
              csv.append(",")
              csv.append(epoch)
              csv.append(",")
              csv.append(name.language ?: "NULL")
              csv.append(",")
              csv.append(StringEscapeUtils.escapeCsv(name.value))
              csv.append("\n")
            }
          }
      copyStreamToPg("trail_names", stream, hikari)
    }
  }
}
