package org.trailcatalog.importers

import com.zaxxer.hikari.HikariDataSource
import org.trailcatalog.importers.pbf.Way
import org.trailcatalog.importers.pipeline.PSink
import org.trailcatalog.importers.pipeline.collections.PCollection
import org.trailcatalog.importers.pipeline.collections.PMap

class DumpPathsInTrails(private val epoch: Int, private val hikari: HikariDataSource)
  : PSink<PCollection<Trail>>() {

  override fun write(input: PCollection<Trail>) {
    input.use {
      val stream =
          StringifyingInputStream(input) { trail, csv ->
            val paths = HashSet<Long>()
            for (path in trail.paths) {
              paths.add(path)
            }
            for (path in paths) {
              // path_id,trail_id,epoch
              csv.append(path)
              csv.append(",")
              csv.append(trail.relationId)
              csv.append(",")
              csv.append(epoch)
              csv.append("\n")
            }
          }
      copyStreamToPg("paths_in_trails", stream, hikari)
    }
  }
}