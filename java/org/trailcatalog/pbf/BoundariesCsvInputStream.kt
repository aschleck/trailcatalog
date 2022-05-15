package org.trailcatalog.pbf

import com.google.protobuf.ByteString
import crosby.binary.Osmformat.PrimitiveBlock
import crosby.binary.Osmformat.PrimitiveGroup
import java.nio.charset.StandardCharsets
import org.apache.commons.text.StringEscapeUtils.escapeCsv
import org.trailcatalog.models.RelationCategory
import org.trailcatalog.proto.RelationGeometry
import org.trailcatalog.proto.RelationMember
import org.trailcatalog.proto.RelationSkeleton
import org.trailcatalog.proto.RelationSkeletonMember.ValueCase.NODE_ID
import org.trailcatalog.proto.RelationSkeletonMember.ValueCase.RELATION_ID
import org.trailcatalog.proto.RelationSkeletonMember.ValueCase.WAY_ID
import org.trailcatalog.proto.WayGeometry

class BoundariesCsvInputStream(
    private val relations: Map<Long, ByteString>,
    private val ways: Map<Long, LongArray>,
    block: PrimitiveBlock)
  : PbfEntityInputStream(
      block,
      "id,type,cell,name,relation_geometry,s2_polygon,representative_boundary,source_relation,address\n".toByteArray(StandardCharsets.UTF_8),
  ) {

  override fun convertToCsv(group: PrimitiveGroup, csv: StringBuilder) {
    for (relation in group.relationsList) {
      val data = getRelationData(relation, block.stringtable)
      if (data.name == null) {
        continue
      }
      if (!RelationCategory.BOUNDARY.isParentOf(data.type)) {
        continue
      }

      val geometry = inflate(relation.id, relations, HashSet(), ways)

      csv.append(relation.id)
      csv.append(",")
      csv.append(data.type.id)
      csv.append(",")
      csv.append(-1)
      csv.append(",")
      csv.append(escapeCsv(data.name))
      csv.append(",")
      if (geometry == null) {
        csv.append("\\x")
      } else {
        appendByteArray(geometry.toByteArray(), csv)
      }
      csv.append(",")
      appendByteArray(byteArrayOf(), csv)
      csv.append(",")
      csv.append(relation.id)
      csv.append(",")
      csv.append("\n")
    }
  }

  private fun inflate(
      id: Long,
      relations: Map<Long, ByteString>,
      used: MutableSet<Long>,
      ways: Map<Long, LongArray>): RelationGeometry? {
    if (used.contains(id)) {
      println("relation ${id} was has a cyclic usage")
      return null
    }

    used.add(id)
    val geometry = RelationGeometry.newBuilder()
    val relationBytes = relations[id] ?: return null
    for (member in RelationSkeleton.parseFrom(relationBytes).membersList) {
      when (member.valueCase) {
        NODE_ID -> {}
        RELATION_ID ->
          geometry.addMembers(
              RelationMember.newBuilder()
                  .setFunction(member.function)
                  .setRelation(inflate(member.relationId, relations, used, ways) ?: return null))
        WAY_ID -> {
          val way = WayGeometry.newBuilder()
          (ways[member.wayId] ?: return null).forEach { way.addNodeIds(it) }
          geometry.addMembers(RelationMember.newBuilder().setFunction(member.function).setWay(way))
        }
        else -> throw AssertionError()
      }
    }
    return geometry.build()
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