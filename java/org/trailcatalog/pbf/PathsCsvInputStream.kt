package org.trailcatalog.pbf

import com.google.common.geometry.S2LatLng
import com.google.common.geometry.S2LatLngRect
import crosby.binary.Osmformat.PrimitiveBlock
import crosby.binary.Osmformat.PrimitiveGroup
import java.nio.charset.StandardCharsets
import org.trailcatalog.s2.boundToCell
import java.nio.ByteBuffer
import java.nio.ByteOrder

class PathsCsvInputStream(
  private val nodes: Map<Long, Pair<Double, Double>>,
  private val ways: MutableMap<Long, ByteArray>,
  block: PrimitiveBlock)
  : PbfEntityInputStream(
      block,
      "id,type,cell,lat_lng_degrees,node_ids,source_way\n".toByteArray(StandardCharsets.UTF_8),
  ) {

  override fun convertToCsv(group: PrimitiveGroup, csv: StringBuilder) {
    for (way in group.waysList) {
      val data = getWayData(way, block.stringtable)
      if (!WayCategory.ROAD.isParentOf(data.type)) {
        val nodeBytes = ByteBuffer.allocate(way.refsCount * 8).order(ByteOrder.LITTLE_ENDIAN)
        var nodeId = 0L
        for (delta in way.refsList) {
          nodeId += delta
          nodeBytes.putLong(nodeId)
        }
        ways[way.id] = nodeBytes.array()
        continue
      }

      val bound = S2LatLngRect.empty().toBuilder()
      val nodeBytes = ByteBuffer.allocate(way.refsCount * 8).order(ByteOrder.LITTLE_ENDIAN)
      val pointBytes = ByteBuffer.allocate(way.refsCount * 2 * 8).order(ByteOrder.LITTLE_ENDIAN)

      var nodeId = 0L
      for (delta in way.refsList) {
        nodeId += delta
        nodeBytes.putLong(nodeId)
        val point = nodes[nodeId]!!
        pointBytes.putDouble(point.first)
        pointBytes.putDouble(point.second)
        bound.addPoint(S2LatLng.fromDegrees(point.first, point.second))
      }

      ways[way.id] = nodeBytes.array()
      csv.append(way.id * 2)
      csv.append(",")
      csv.append(data.type.id)
      csv.append(",")
      csv.append(boundToCell(bound.build()))
      csv.append(",\\x")
      for (b in pointBytes.array()) {
        csv.append(HEX_CHARACTERS[b / 16])
        csv.append(HEX_CHARACTERS[b % 16])
      }
      csv.append(",\\x")
      for (b in nodeBytes.array()) {
        csv.append(HEX_CHARACTERS[b / 16])
        csv.append(HEX_CHARACTERS[b % 16])
      }
      csv.append(",")
      csv.append(way.id)
      csv.append("\n")
    }
  }
}
