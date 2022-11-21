package org.trailcatalog.importers.basemap

import com.zaxxer.hikari.HikariDataSource
import org.trailcatalog.importers.pipeline.PSink
import org.trailcatalog.importers.pipeline.collections.PCollection
import org.trailcatalog.importers.pipeline.collections.PMap
import java.nio.ByteBuffer
import java.nio.ByteOrder

class DumpPathElevations(private val epoch: Int, private val hikari: HikariDataSource)
  : PSink<PMap<Long, Profile>>() {

  override fun write(input: PMap<Long, Profile>) {
    input.use {
      val stream =
          StringifyingInputStream(input) { pair, csv ->
            val profile = pair.values[0]
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
                ByteBuffer.allocate(3 * 4 * profile.profile.size).order(ByteOrder.LITTLE_ENDIAN)
            for (i in 0 until profile.profile.size) {
              val point = profile.points[i]
              samples.putInt(point.lat)
              samples.putInt(point.lng)
              samples.putFloat(profile.profile[i])
            }
            appendByteArray(samples.array(), csv)
            csv.append("\n")
          }
      copyStreamToPg("path_elevations", stream, hikari)
    }
  }
}
