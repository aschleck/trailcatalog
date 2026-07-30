package org.trailcatalog.importers.basemap

import com.zaxxer.hikari.HikariDataSource
import org.apache.commons.text.StringEscapeUtils
import org.trailcatalog.importers.pipeline.PSink
import org.trailcatalog.importers.pipeline.collections.PCollection

class DumpBoundaryNames(private val epoch: Int, private val hikari: HikariDataSource)
  : PSink<PCollection<Boundary>>() {

  override fun write(input: PCollection<Boundary>) {
    input.use {
      val stream =
          StringifyingInputStream(input) { boundary, csv ->
            for (name in boundary.names) {
              // id,epoch,language,name
              csv.append(boundary.id)
              csv.append(",")
              csv.append(epoch)
              csv.append(",")
              csv.append(name.language ?: "NULL")
              csv.append(",")
              csv.append(StringEscapeUtils.escapeCsv(name.value))
              csv.append("\n")
            }
          }
      copyStreamToPg("boundary_names", stream, hikari)
    }
  }
}
