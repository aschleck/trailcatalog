package org.trailcatalog.importers

import com.google.common.geometry.S2LatLng
import com.google.common.geometry.S2LatLngRect
import com.zaxxer.hikari.HikariDataSource
import org.trailcatalog.importers.pbf.Way
import org.trailcatalog.importers.pipeline.PSink
import org.trailcatalog.importers.pipeline.collections.PMap
import org.trailcatalog.models.WayCategory.HIGHWAY
import org.trailcatalog.models.WayCategory.PISTE
import org.trailcatalog.s2.boundToCell
import java.nio.ByteBuffer
import java.nio.ByteOrder

class DumpPaths(private val epoch: Int, private val hikari: HikariDataSource)
  : PSink<PMap<Long, Way>>() {

  override fun write(input: PMap<Long, Way>) {
    input.use {
      val stream =
          StringifyingInputStream(input) { (_, ways), csv ->
            val way = ways[0]
            if (!HIGHWAY.isParentOf(way.type)
                && !PISTE.isParentOf(way.type)
            ) {
              return@StringifyingInputStream
            }

            val latLngDegrees =
                ByteBuffer.allocate(2 * 4 * way.points.size).order(ByteOrder.LITTLE_ENDIAN)
            val bound = S2LatLngRect.empty().toBuilder()
            val asInts = latLngDegrees.asIntBuffer()
            way.points.forEach {
              bound.addPoint(S2LatLng.fromE7(it.lat, it.lng))
              asInts.put(it.lat).put(it.lng)
            }

            // id,epoch,type,cell,lat_lng_degrees,source_way
            csv.append(2 * way.id)
            csv.append(",")
            csv.append(epoch)
            csv.append(",")
            csv.append(way.type)
            csv.append(",")
            csv.append(boundToCell(bound.build()).id())
            csv.append(",")
            appendByteArray(latLngDegrees.array(), csv)
            csv.append(",")
            csv.append(way.id)
            csv.append("\n")
          }
      copyStreamToPg("paths", stream, hikari)
    }
  }
}
