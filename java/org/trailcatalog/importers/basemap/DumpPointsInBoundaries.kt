package org.trailcatalog.importers.basemap

import com.zaxxer.hikari.HikariDataSource
import org.trailcatalog.importers.pipeline.PSink
import org.trailcatalog.importers.pipeline.collections.PMap

class DumpPointsInBoundaries(private val epoch: Int, private val hikari: HikariDataSource)
  : PSink<PMap<Long, Long>>() {

  override fun write(input: PMap<Long, Long>) {
    input.use {
      val stream =
          StringifyingInputStream(input) { entry, csv ->
            val point = entry.key
            for (boundary in entry.values) {
              // boundary_id,point_id,epoch
              csv.append(boundary)
              csv.append(",")
              csv.append(point)
              csv.append(",")
              csv.append(epoch)
              csv.append("\n")
            }
          }
      copyStreamToPg("points_in_boundaries", stream, hikari)
    }
  }
}
