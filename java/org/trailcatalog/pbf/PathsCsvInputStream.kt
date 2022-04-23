package org.trailcatalog.pbf

import crosby.binary.Osmformat.PrimitiveBlock
import crosby.binary.Osmformat.PrimitiveGroup
import org.trailcatalog.models.WayCategory
import java.nio.charset.StandardCharsets
import java.nio.ByteBuffer
import java.nio.ByteOrder

class PathsCsvInputStream(
  private val ways: MutableMap<Long, LongArray>,
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
      var nodeId = 0L
      for (i in 0 until way.refsCount) {
        nodeId += way.getRefs(i)
        nodes[i] = nodeId
        nodeBytes.putLong(nodeId)
      }

      ways[way.id] = nodes

      if (!WayCategory.HIGHWAY.isParentOf(data.type) && !WayCategory.PISTE.isParentOf(data.type)) {
        continue
      }
      csv.append(way.id * 2)
      csv.append(",")
      csv.append(data.type.id)
      csv.append(",")
      csv.append(-1)
      csv.append(",\\x,")
      appendByteArray(nodeBytes.array(), csv)
      csv.append(",")
      csv.append(way.id)
      csv.append("\n")
    }
  }
}
