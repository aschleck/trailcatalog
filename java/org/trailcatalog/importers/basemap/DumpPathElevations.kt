package org.trailcatalog.importers.basemap

import com.zaxxer.hikari.HikariDataSource
import org.trailcatalog.importers.pipeline.PSink
import org.trailcatalog.importers.pipeline.collections.PCollection
import java.nio.ByteBuffer
import java.nio.ByteOrder

class DumpPathElevations(private val epoch: Int, private val hikari: HikariDataSource)
  : PSink<PCollection<Profile>>() {

  override fun write(input: PCollection<Profile>) {
    input.use {
      val stream =
          StringifyingInputStream(input) { profile, csv ->
            // id,epoch,down_meters,up_meters,height_samples_10m_meters
            csv.append(2 * profile.id)
            csv.append(",")
            csv.append(epoch)
            csv.append(",")
            csv.append(profile.down)
            csv.append(",")
            csv.append(profile.up)
            csv.append(",")
            val samples =
                ByteBuffer.allocate(4 * profile.profile.size).order(ByteOrder.LITTLE_ENDIAN)
            val asFloats = samples.asFloatBuffer()
            profile.profile.forEach {
              asFloats.put(it)
            }
            appendByteArray(samples.array(), csv)
            csv.append("\n")
          }
      copyStreamToPg("path_elevations", stream, hikari)
    }
  }
}
