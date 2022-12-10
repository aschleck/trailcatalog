package org.trailcatalog.importers.basemap

import com.zaxxer.hikari.HikariDataSource
import org.trailcatalog.importers.pipeline.PSink
import org.trailcatalog.importers.pipeline.collections.PMap

class DumpReadableTrailIds(private val epoch: Int, private val hikari: HikariDataSource)
  : PSink<PMap<String, Long>>() {

  override fun write(input: PMap<String, Long>) {
    input.use {
      val stream =
          StringifyingInputStream(input) { trail, csv ->
            // numeric_id,readable_id,epoch
            csv.append(trail.values[0])
            csv.append(",\"")
            csv.append(trail.key)
            csv.append("\",")
            csv.append(epoch)
            csv.append("\n")
          }
      copyStreamToPg("trail_identifiers", stream, hikari)
    }
  }
}
