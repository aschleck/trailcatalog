package org.trailcatalog.importers.basemap

import com.zaxxer.hikari.HikariDataSource
import org.apache.commons.text.StringEscapeUtils
import org.trailcatalog.importers.pbf.Name
import org.trailcatalog.importers.pipeline.PSink
import org.trailcatalog.importers.pipeline.collections.PCollection

class DumpNames<V : Any>(
    private val table: String,
    private val epoch: Int,
    private val hikari: HikariDataSource,
    private val getId: (V) -> Long,
    private val getNames: (V) -> List<Name>,
) : PSink<PCollection<V>>() {

  override fun write(input: PCollection<V>) {
    input.use {
      val stream =
          StringifyingInputStream(input) { v, csv ->
            for (name in getNames(v)) {
              // id,epoch,language,name
              csv.append(getId(v))
              csv.append(",")
              csv.append(epoch)
              csv.append(",")
              csv.append(name.language ?: "NULL")
              csv.append(",")
              csv.append(StringEscapeUtils.escapeCsv(name.value))
              csv.append("\n")
            }
          }
      copyStreamToPg(table, stream, hikari)
    }
  }
}
