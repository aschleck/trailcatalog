package org.trailcatalog.pbf

import com.google.common.geometry.S2LatLng
import com.google.common.geometry.S2LatLngRect
import crosby.binary.Osmformat.PrimitiveBlock
import crosby.binary.Osmformat.PrimitiveGroup
import crosby.binary.Osmformat.Relation.MemberType.NODE
import crosby.binary.Osmformat.Relation.MemberType.RELATION
import crosby.binary.Osmformat.Relation.MemberType.WAY
import java.nio.charset.StandardCharsets
import org.apache.commons.text.StringEscapeUtils.escapeCsv
import org.trailcatalog.s2.boundToCell
import java.nio.ByteBuffer
import java.nio.ByteOrder

class BoundariesCsvInputStream(
  private val nodes: Map<Long, Pair<Double, Double>>,
  private val relations: MutableMap<Long, ByteArray>,
  private val relationWays: MutableMap<Long, ByteArray>,
  private val ways: Map<Long, ByteArray>,
  block: PrimitiveBlock)
  : PbfEntityInputStream(
      block,
      "id,type,cell,name,lat_lng_degrees,node_ids,source_relation\n".toByteArray(StandardCharsets.UTF_8),
  ) {

  override fun convertToCsv(group: PrimitiveGroup, csv: StringBuilder) {
    for (relation in group.relationsList) {
      val data = getRelationData(relation, block.stringtable)

      val nodeComponents = ArrayList<ByteArray>()
      val wayComponents = ArrayList<ByteArray>()
      var memberId = 0L
      for (i in 0 until relation.memidsCount) {
        memberId += relation.getMemids(i)
        when (relation.getTypes(i)) {
          NODE -> {
            val bytes = ByteBuffer.allocate(8).order(ByteOrder.LITTLE_ENDIAN)
            bytes.putLong(memberId)
            nodeComponents.add(bytes.array())
          }
          RELATION -> {
            nodeComponents.add(relations[memberId]!!)
            wayComponents.add(relationWays[memberId]!!)
          }
          WAY -> {
            nodeComponents.add(ways[memberId]!!)
            val bytes = ByteBuffer.allocate(8).order(ByteOrder.LITTLE_ENDIAN)
            bytes.putLong(memberId)
            wayComponents.add(bytes.array())
          }
          null -> {}
        }
      }

      val nodeBytes = ByteBuffer.allocate(nodeComponents.sumOf { it.size }).order(ByteOrder.LITTLE_ENDIAN)
      nodeComponents.forEach { nodeBytes.put(it) }
      relations[relation.id] = nodeBytes.array()
      val wayBytes = ByteBuffer.allocate(wayComponents.sumOf { it.size }).order(ByteOrder.LITTLE_ENDIAN)
      wayComponents.forEach { nodeBytes.put(it) }
      relationWays[relation.id] = wayBytes.array()

      if (!RelationCategory.BOUNDARY.isParentOf(data.type)) {
        continue
      }

      val allNodeIds = nodeBytes.reset().asLongBuffer()
      val pointBytes = ByteBuffer.allocate(allNodeIds.remaining() * 2 * 8).order(ByteOrder.LITTLE_ENDIAN)
      val bound = S2LatLngRect.empty().toBuilder()

      while (allNodeIds.hasRemaining()) {
        val point = nodes[allNodeIds.get()]!!
        pointBytes.putDouble(point.first)
        pointBytes.putDouble(point.second)
        bound.addPoint(S2LatLng.fromDegrees(point.first, point.second))
      }

      csv.append(relation.id)
      csv.append(",")
      csv.append(data.type.id)
      csv.append(",")
      csv.append(boundToCell(bound.build()))
      csv.append(",")
      if (data.name != null) {
        csv.append(escapeCsv(data.name))
      }
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
      csv.append(relation.id)
      csv.append("\n")
    }
  }
}
