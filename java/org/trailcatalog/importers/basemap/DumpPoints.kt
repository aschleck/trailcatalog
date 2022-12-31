package org.trailcatalog.importers.basemap

import com.zaxxer.hikari.HikariDataSource
import java.nio.ByteBuffer
import java.nio.ByteOrder
import org.apache.commons.text.StringEscapeUtils
import org.trailcatalog.importers.pbf.Point
import org.trailcatalog.importers.pipeline.PSink
import org.trailcatalog.importers.pipeline.collections.PList
import org.trailcatalog.models.PointCategory
import org.trailcatalog.s2.latLngToCell

private val BYTE_BUFFER = ByteBuffer.allocate(16).order(ByteOrder.LITTLE_ENDIAN)

class DumpPoints(private val epoch: Int, private val hikari: HikariDataSource)
  : PSink<PList<Point>>() {

  override fun write(input: PList<Point>) {
    input.use {
      val stream =
          StringifyingInputStream(input) { point, csv ->
            val markerAsInts = BYTE_BUFFER.asIntBuffer()
            markerAsInts.put(point.latLng.lat)
            markerAsInts.put(point.latLng.lng)

            // id,epoch,type,cell,name,marker_degrees_e7
            csv.append(point.id)
            csv.append(",")
            csv.append(epoch)
            csv.append(",")
            csv.append(point.type)
            csv.append(",")
            csv.append(latLngToCell(point.latLng.toS2LatLng()).id())
            csv.append(",")
            if (point.name == null) {
              csv.append("NULL")
            } else {
              csv.append(StringEscapeUtils.escapeCsv(point.name))
            }
            csv.append(",")
            appendByteBuffer(BYTE_BUFFER, csv)
            BYTE_BUFFER.clear()
            csv.append("\n")
          }
      copyStreamToPg("points", stream, hikari)
    }
  }
}
