package org.trailcatalog.importers

import com.zaxxer.hikari.HikariDataSource
import org.apache.commons.text.StringEscapeUtils
import org.trailcatalog.importers.pbf.LatLngRectE7
import org.trailcatalog.importers.pipeline.PSink
import org.trailcatalog.importers.pipeline.collections.PCollection
import org.trailcatalog.s2.boundToCell
import java.nio.ByteBuffer
import java.nio.ByteOrder

class DumpTrails(private val epoch: Int, private val hikari: HikariDataSource)
  : PSink<PCollection<Trail>>() {

  override fun write(input: PCollection<Trail>) {
    input.use {
      val stream =
          StringifyingInputStream(input) { trail, csv ->
            val bound = LatLngRectE7.from(trail.polyline.rectBound)
            val cell = boundToCell(trail.polyline.rectBound).id()
            val marker = trail.polyline.interpolate(0.5).toLatLngE7()
            val lengthMeters = polylineToMeters(trail.polyline)

            // id,epoch,type,cell,name,path_ids,bound_degrees_e7,marker_degrees_e7,
            // elevation_down_meters,elevation_up_meters,length_meters,representative_boundary,
            // source_relation
            csv.append(trail.relationId)
            csv.append(",")
            csv.append(epoch)
            csv.append(",")
            csv.append(trail.type)
            csv.append(",")
            csv.append(cell)
            csv.append(",")
            csv.append(StringEscapeUtils.escapeCsv(trail.name))
            csv.append(",")
            val paths = ByteBuffer.allocate(8 * trail.paths.size).order(ByteOrder.LITTLE_ENDIAN)
            val asLongs = paths.asLongBuffer()
            trail.paths.forEach {
              asLongs.put(it)
            }
            appendByteArray(paths.array(), csv)
            csv.append(",")
            val boundBuffer = ByteBuffer.allocate(4 * 4).order(ByteOrder.LITTLE_ENDIAN)
            val boundAsInts = boundBuffer.asIntBuffer()
            boundAsInts.put(bound.lowLat)
            boundAsInts.put(bound.lowLng)
            boundAsInts.put(bound.highLat)
            boundAsInts.put(bound.highLng)
            appendByteArray(boundBuffer.array(), csv)
            csv.append(",")
            val markerBuffer = ByteBuffer.allocate(2 * 4).order(ByteOrder.LITTLE_ENDIAN)
            val markerAsInts = markerBuffer.asIntBuffer()
            markerAsInts.put(marker.lat)
            markerAsInts.put(marker.lng)
            appendByteArray(markerBuffer.array(), csv)
            csv.append(",0,0,")
            csv.append(lengthMeters)
            csv.append(",,")
            csv.append(trail.relationId)
            csv.append("\n")
          }
      copyStreamToPg("trails", stream, hikari)
    }
  }
}
