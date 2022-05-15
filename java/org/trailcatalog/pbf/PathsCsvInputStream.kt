package org.trailcatalog.pbf

import com.google.common.geometry.S2LatLng
import com.google.common.geometry.S2LatLngRect
import crosby.binary.Osmformat.PrimitiveBlock
import crosby.binary.Osmformat.PrimitiveGroup
import org.trailcatalog.models.WayCategory
import org.trailcatalog.s2.boundToCell
import java.nio.charset.StandardCharsets
import java.nio.ByteBuffer
import java.nio.ByteOrder

class PathsCsvInputStream(
    private val nodes: Map<Long, NodeRecord>?,
    block: PrimitiveBlock)
  : PbfEntityInputStream(
      block,
      "id,type,cell,lat_lng_degrees,node_ids,source_way\n".toByteArray(StandardCharsets.UTF_8),
  ) {

  override fun convertToCsv(group: PrimitiveGroup, csv: StringBuilder) {
    for (way in group.waysList) {
      val data = getWayData(way, block.stringtable)

      val nodes = LongArray(way.refsCount)
      val nodeBytes = ByteBuffer.allocate(way.refsCount * 8).order(ByteOrder.LITTLE_ENDIAN)
      var denseNodeId = 0L
      for (i in 0 until way.refsCount) {
        denseNodeId += way.getRefs(i)
        nodes[i] = denseNodeId
        nodeBytes.putLong(denseNodeId)
      }

      val (cell, latLngs) =
          if (this.nodes == null) {
            Pair(-1, byteArrayOf())
          } else {
            val bound = S2LatLngRect.empty().toBuilder()
            val latLngs = ByteBuffer.allocate(2 * way.refsCount * 8).order(ByteOrder.LITTLE_ENDIAN)
            var valid = true
            for (nodeId in nodes) {
              val position = this.nodes[nodeId]
              if (position == null) {
                valid = false
                break
              }

              latLngs.putDouble(position.lat)
              latLngs.putDouble(position.lng)
              bound.addPoint(S2LatLng.fromDegrees(position.lat, position.lng))
            }

            if (valid) {
              Pair(boundToCell(bound.build()).id(), latLngs.array())
            } else {
              Pair(-1, byteArrayOf())
            }
          }

      if (!WayCategory.HIGHWAY.isParentOf(data.type) && !WayCategory.PISTE.isParentOf(data.type)) {
        continue
      }
      csv.append(way.id * 2)
      csv.append(",")
      csv.append(data.type.id)
      csv.append(",")
      csv.append(cell)
      csv.append(",")
      appendByteArray(latLngs, csv)
      csv.append(",")
      appendByteArray(nodeBytes.array(), csv)
      csv.append(",")
      csv.append(way.id)
      csv.append("\n")
    }
  }
}
