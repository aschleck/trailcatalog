package org.trailcatalog.importers

import com.zaxxer.hikari.HikariDataSource
import org.trailcatalog.importers.pipeline.PSink
import org.trailcatalog.importers.pipeline.collections.PMap

class DumpTrailsInBoundaries(private val epoch: Int, private val hikari: HikariDataSource)
  : PSink<PMap<Long, Long>>() {

  override fun write(input: PMap<Long, Long>) {
    input.use {
      val stream =
          StringifyingInputStream(input) { entry, csv ->
            val trail = entry.key
            val seen = HashSet<Long>()
            for (boundary in entry.values) {
              if (seen.contains(boundary)) {
                continue
              }
              seen.add(boundary)

              // boundary_id,trail_id,epoch
              csv.append(boundary)
              csv.append(",")
              csv.append(trail)
              csv.append(",")
              csv.append(epoch)
              csv.append("\n")
            }
          }
      copyStreamToPg("trails_in_boundaries", stream, hikari)
    }
  }
}
