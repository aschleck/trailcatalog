package org.trailcatalog.importers.basemap

import com.zaxxer.hikari.HikariDataSource
import org.apache.commons.text.StringEscapeUtils
import org.postgresql.copy.CopyManager
import org.postgresql.jdbc.PgConnection
import org.trailcatalog.importers.pipeline.PSink
import org.trailcatalog.importers.pipeline.collections.PCollection
import java.io.InputStream

class DumpBoundaries(private val epoch: Int, private val hikari: HikariDataSource)
  : PSink<PCollection<Boundary>>() {

  override fun write(input: PCollection<Boundary>) {
    input.use {
      val stream =
          StringifyingInputStream(input) { boundary, csv ->
            // id,epoch,type,cell,name,s2_polygon,source_relation
            csv.append(boundary.id)
            csv.append(",")
            csv.append(epoch)
            csv.append(",")
            csv.append(boundary.type)
            csv.append(",")
            csv.append(boundary.cell)
            csv.append(",")
            csv.append(StringEscapeUtils.escapeCsv(boundary.name))
            csv.append(",")
            appendByteArray(boundary.s2Polygon, csv)
            csv.append(",")
            csv.append(boundary.id)
            csv.append("\n")
          }
      copyStreamToPg("boundaries", stream, hikari)
    }
  }
}
