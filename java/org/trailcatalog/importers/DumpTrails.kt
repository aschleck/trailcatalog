package org.trailcatalog.importers

import com.zaxxer.hikari.HikariDataSource
import org.apache.commons.text.StringEscapeUtils
import org.postgresql.copy.CopyManager
import org.postgresql.jdbc.PgConnection
import org.trailcatalog.importers.pipeline.PSink
import org.trailcatalog.importers.pipeline.collections.PCollection
import java.nio.ByteBuffer
import java.nio.ByteOrder

class DumpTrails(private val epoch: Int, private val hikari: HikariDataSource)
  : PSink<PCollection<Trail>>() {

  override fun write(input: PCollection<Trail>) {
    input.use {
      val stream =
          StringifyingInputStream(input) { trail, csv ->
            // id,epoch,type,cell,name,path_ids,bound_degrees_e7,marker_degrees_e7,
            // elevation_down_meters,elevation_up_meters,length_meters,representative_boundary,
            // source_relation
            csv.append(trail.relationId)
            csv.append(",")
            csv.append(epoch)
            csv.append(",")
            csv.append(trail.type)
            csv.append(",")
            csv.append(trail.cell)
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
            val bound = ByteBuffer.allocate(4 * 4).order(ByteOrder.LITTLE_ENDIAN)
            val boundAsInts = bound.asIntBuffer()
            boundAsInts.put(trail.bound.lowLat)
            boundAsInts.put(trail.bound.lowLng)
            boundAsInts.put(trail.bound.highLat)
            boundAsInts.put(trail.bound.highLng)
            appendByteArray(bound.array(), csv)
            csv.append(",")
            val marker = ByteBuffer.allocate(2 * 4).order(ByteOrder.LITTLE_ENDIAN)
            val markerAsInts = marker.asIntBuffer()
            markerAsInts.put(trail.marker.lat)
            markerAsInts.put(trail.marker.lng)
            appendByteArray(marker.array(), csv)
            csv.append(",0,0,")
            csv.append(trail.lengthMeters)
            csv.append(",,")
            csv.append(trail.relationId)
            csv.append("\n")
          }
      copyStreamToPg("trails", stream, hikari)
    }
  }
}
