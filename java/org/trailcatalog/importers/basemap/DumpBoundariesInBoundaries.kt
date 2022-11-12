package org.trailcatalog.importers.basemap

import com.zaxxer.hikari.HikariDataSource
import org.trailcatalog.importers.pipeline.PSink
import org.trailcatalog.importers.pipeline.collections.PMap

class DumpBoundariesInBoundaries(private val epoch: Int, private val hikari: HikariDataSource)
  : PSink<PMap<Long, Long>>() {

  override fun write(input: PMap<Long, Long>) {
    input.use {
      val stream =
          StringifyingInputStream(input) { entry, csv ->
            val child = entry.key
            val seen = HashSet<Long>()
            for (parent in entry.values) {
              if (seen.contains(parent)) {
                continue
              }
              seen.add(parent)

              // child_id,parent_id,epoch
              csv.append(child)
              csv.append(",")
              csv.append(parent)
              csv.append(",")
              csv.append(epoch)
              csv.append("\n")
            }
          }
      copyStreamToPg("boundaries_in_boundaries", stream, hikari)
    }
  }
}
