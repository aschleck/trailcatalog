package org.trailcatalog.pbf

import crosby.binary.Osmformat.PrimitiveBlock
import crosby.binary.Osmformat.PrimitiveGroup
import crosby.binary.Osmformat.Relation.MemberType.NODE
import crosby.binary.Osmformat.Relation.MemberType.RELATION
import crosby.binary.Osmformat.Relation.MemberType.WAY
import java.nio.charset.StandardCharsets
import org.apache.commons.text.StringEscapeUtils.escapeCsv
import org.trailcatalog.models.RelationCategory
import java.nio.ByteBuffer
import java.nio.ByteOrder

class BoundariesCsvInputStream(
  private val nodes: Set<Long>,
  private val relations: MutableMap<Long, ByteArray>,
  private val relationWays: MutableMap<Long, ByteArray>,
  private val ways: Map<Long, ByteArray>,
  block: PrimitiveBlock)
  : PbfEntityInputStream(
      block,
      "id,type,cell,name,lat_lng_degrees,node_ids,representative_boundary,source_relation,address\n".toByteArray(StandardCharsets.UTF_8),
  ) {

  override fun convertToCsv(group: PrimitiveGroup, csv: StringBuilder) {
    for (relation in group.relationsList) {
      val data = getRelationData(relation, block.stringtable)

      val nodeComponents = ArrayList<ByteArray>()
      val wayComponents = ArrayList<ByteArray>()
      var memberId = 0L
      var valid = true
      for (i in 0 until relation.memidsCount) {
        memberId += relation.getMemids(i)
        when (relation.getTypes(i)) {
          NODE -> {
            if (nodes.contains(memberId)) {
              val bytes = ByteBuffer.allocate(8).order(ByteOrder.LITTLE_ENDIAN)
              bytes.putLong(memberId)
              nodeComponents.add(bytes.array())
            } else {
              valid = false
              break
            }
          }
          RELATION -> {
            val child = relations[memberId]
            if (child == null) {
              valid = false
              break
            }
            nodeComponents.add(child)
            wayComponents.add(relationWays[memberId]!!)
          }
          WAY -> {
            val way = ways[memberId]
            if (way == null) {
              valid = false
              break
            }
            nodeComponents.add(way)
            val bytes = ByteBuffer.allocate(8).order(ByteOrder.LITTLE_ENDIAN)
            bytes.putLong(memberId)
            wayComponents.add(bytes.array())
          }
          null -> {}
        }
      }

      val nodeBytes = ByteBuffer.allocate(nodeComponents.sumOf { it.size }).order(ByteOrder.LITTLE_ENDIAN)
      val wayBytes = ByteBuffer.allocate(wayComponents.sumOf { it.size }).order(ByteOrder.LITTLE_ENDIAN)

      if (valid) {
        nodeComponents.forEach { nodeBytes.put(it) }
        relations[relation.id] = nodeBytes.array()
        wayComponents.forEach { wayBytes.put(it) }
        relationWays[relation.id] = wayBytes.array()
      }

      if (data.name == null) {
        continue
      }
      if (!RelationCategory.BOUNDARY.isParentOf(data.type)) {
        continue
      }

      csv.append(relation.id)
      csv.append(",")
      csv.append(data.type.id)
      csv.append(",")
      csv.append(-1)
      csv.append(",")
      csv.append(escapeCsv(data.name))
      csv.append(",")
      appendByteArray(byteArrayOf(), csv)
      csv.append(",")
      if (valid) {
        appendByteArray(nodeBytes.array(), csv)
      } else {
        csv.append("\\x")
      }
      csv.append(",")
      csv.append(relation.id)
      csv.append(",")
      csv.append("\n")
    }
  }
}

fun appendByteArray(bytes: ByteArray, output: StringBuilder) {
  output.append("\\x")
  for (b in bytes) {
    val i = b.toInt() and 0xff
    output.append(HEX_CHARACTERS[i / 16])
    output.append(HEX_CHARACTERS[i % 16])
  }
}