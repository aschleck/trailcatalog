package org.trailcatalog.importers.basemap

import com.zaxxer.hikari.HikariDataSource
import org.apache.commons.text.StringEscapeUtils
import org.trailcatalog.importers.pbf.SourceTags
import org.trailcatalog.importers.pipeline.PSink
import org.trailcatalog.importers.pipeline.collections.PCollection

class DumpSourceTags(private val epoch: Int, private val hikari: HikariDataSource)
  : PSink<PCollection<SourceTags>>() {

  override fun write(input: PCollection<SourceTags>) {
    input.use {
      val stream = StringifyingInputStream(input) { tags, csv ->
        // source_type,source_id,epoch,version,tags
        csv.append(tags.type.id)
        csv.append(",")
        csv.append(tags.id)
        csv.append(",")
        csv.append(epoch)
        csv.append(",")
        csv.append(tags.version ?: "NULL")
        csv.append(",")
        csv.append(StringEscapeUtils.escapeCsv(tags.tagsJson))
        csv.append("\n")
      }
      copyStreamToPg("source_tags", stream, hikari)
    }
  }
}
