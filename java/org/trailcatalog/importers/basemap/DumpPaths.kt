package org.trailcatalog.importers.basemap

import com.google.common.geometry.S2LatLngRect
import com.zaxxer.hikari.HikariDataSource
import java.nio.ByteBuffer
import java.nio.ByteOrder
import org.trailcatalog.common.DeltaLatLngE7
import org.trailcatalog.importers.pbf.Way
import org.trailcatalog.importers.pipeline.PSink
import org.trailcatalog.importers.pipeline.collections.PMap
import org.trailcatalog.models.WayCategory
import org.trailcatalog.s2.boundToCell

private val BYTE_BUFFER: ThreadLocal<ByteBuffer> = ThreadLocal.withInitial {
  ByteBuffer.allocate(1 * 1024 * 1024).order(ByteOrder.LITTLE_ENDIAN)
}

class DumpPaths(private val epoch: Int, private val hikari: HikariDataSource)
  : PSink<PMap<Long, Way>>() {

  override fun write(input: PMap<Long, Way>) {
    input.use {
      val stream =
          StringifyingInputStream(input) { (_, ways), csv ->
            val way = ways[0]
            if (way.type == WayCategory.ANY.id) {
              return@StringifyingInputStream
            }

            val buffer = BYTE_BUFFER.get()
            val bound = S2LatLngRect.empty().toBuilder()
            val latLngE7 = IntArray(2 * way.points.size)
            for (i in way.points.indices) {
              val e7 = way.points[i]
              bound.addPoint(e7.toS2LatLng())
              latLngE7[2 * i] = e7.lat
              latLngE7[2 * i + 1] = e7.lng
            }
            DeltaLatLngE7.encode(latLngE7, way.points.size, buffer)
            buffer.flip()

            // id,epoch,type,cell,lat_lng_degrees,source_way
            // lat_lng_degrees is DeltaLatLngE7, so readers cannot divide its length to get a
            // point count.
            csv.append(2 * way.id)
            csv.append(",")
            csv.append(epoch)
            csv.append(",")
            csv.append(way.type)
            csv.append(",")
            csv.append(boundToCell(bound.build()).id())
            csv.append(",")
            appendByteBuffer(buffer, csv)
            buffer.clear()
            csv.append(",")
            csv.append(way.id)
            csv.append("\n")
          }
      copyStreamToPg("paths", stream, hikari)
    }
  }
}
