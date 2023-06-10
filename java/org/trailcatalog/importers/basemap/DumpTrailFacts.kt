package org.trailcatalog.importers.basemap

import com.zaxxer.hikari.HikariDataSource
import org.apache.commons.text.StringEscapeUtils
import org.trailcatalog.importers.pbf.LatLngRectE7
import org.trailcatalog.importers.pipeline.PSink
import org.trailcatalog.importers.pipeline.collections.PCollection
import org.trailcatalog.s2.polylineToCell
import java.nio.ByteBuffer
import java.nio.ByteOrder

class DumpTrailFacts(private val epoch: Int, private val hikari: HikariDataSource)
  : PSink<PCollection<Trail>>() {

  override fun write(input: PCollection<Trail>) {
    input.use {
      val stream =
          StringifyingInputStream(input) { trail, csv ->
            for (fact in trail.facts) {
              // trail_id,epoch,predicate,object
              csv.append(trail.relationId)
              csv.append(",")
              csv.append(epoch)
              csv.append(",")
              csv.append(StringEscapeUtils.escapeCsv(fact.predicate))
              csv.append(",")
              csv.append(StringEscapeUtils.escapeCsv(fact.value))
              csv.append("\n")
            }
          }
      copyStreamToPg("trail_facts", stream, hikari)
    }
  }
}
