package org.trailcatalog.importers.basemap

import com.zaxxer.hikari.HikariDataSource
import org.apache.commons.text.StringEscapeUtils
import org.trailcatalog.importers.pbf.Point
import org.trailcatalog.importers.pipeline.PSink
import org.trailcatalog.importers.pipeline.collections.PCollection

class DumpPointNames(private val epoch: Int, private val hikari: HikariDataSource)
  : PSink<PCollection<Point>>() {

  override fun write(input: PCollection<Point>) {
    input.use {
      val stream =
          StringifyingInputStream(input) { point, csv ->
            for (name in point.names) {
              // id,epoch,language,name
              csv.append(point.id)
              csv.append(",")
              csv.append(epoch)
              csv.append(",")
              csv.append(name.language ?: "NULL")
              csv.append(",")
              csv.append(StringEscapeUtils.escapeCsv(name.value))
              csv.append("\n")
            }
          }
      copyStreamToPg("point_names", stream, hikari)
    }
  }
}
