package org.trailcatalog.importers.basemap

import com.google.common.geometry.S2LatLngRect
import com.zaxxer.hikari.HikariDataSource
import java.nio.ByteBuffer
import java.nio.ByteOrder
import org.trailcatalog.importers.pbf.Way
import org.trailcatalog.importers.pipeline.PSink
import org.trailcatalog.importers.pipeline.collections.PMap
import org.trailcatalog.models.WayCategory
import org.trailcatalog.s2.boundToCell

private val BYTE_BUFFER = ByteBuffer.allocate(1 * 1024 * 1024).order(ByteOrder.LITTLE_ENDIAN)

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

            val bound = S2LatLngRect.empty().toBuilder()
            val asInts = BYTE_BUFFER.asIntBuffer()
            for (e7 in way.points) {
              bound.addPoint(e7.toS2LatLng())
              asInts.put(e7.lat).put(e7.lng)
            }
            BYTE_BUFFER.limit(4 * asInts.position()) // ? can we do this better?

            // id,epoch,type,cell,lat_lng_degrees,source_way
            csv.append(2 * way.id)
            csv.append(",")
            csv.append(epoch)
            csv.append(",")
            csv.append(way.type)
            csv.append(",")
            csv.append(boundToCell(bound.build()).id())
            csv.append(",")
            appendByteBuffer(BYTE_BUFFER, csv)
            BYTE_BUFFER.clear()
            csv.append(",")
            csv.append(way.id)
            csv.append("\n")
          }
      copyStreamToPg("paths", stream, hikari)
    }
  }
}
