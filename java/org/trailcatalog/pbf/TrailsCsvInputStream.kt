package org.trailcatalog.pbf

import com.google.common.geometry.S2Polyline
import com.google.protobuf.ByteString
import crosby.binary.Osmformat.PrimitiveBlock
import crosby.binary.Osmformat.PrimitiveGroup
import java.nio.charset.StandardCharsets
import org.apache.commons.text.StringEscapeUtils.escapeCsv
import org.trailcatalog.models.RelationCategory
import org.trailcatalog.proto.RelationSkeleton
import org.trailcatalog.proto.RelationSkeletonMember.ValueCase.NODE_ID
import org.trailcatalog.proto.RelationSkeletonMember.ValueCase.RELATION_ID
import org.trailcatalog.proto.RelationSkeletonMember.ValueCase.WAY_ID
import java.nio.ByteBuffer
import java.nio.ByteOrder

class TrailsCsvInputStream(

    private val relations: Map<Long, ByteString>,
    block: PrimitiveBlock)
  : PbfEntityInputStream(
    block,
    "id,type,cell,name,path_ids,center_lat_degrees,center_lng_degrees,elevation_delta_meters,length_meters,source_relation,source_way,visibility\n".toByteArray(StandardCharsets.UTF_8),
) {

  override fun convertToCsv(group: PrimitiveGroup, csv: StringBuilder) {
    for (relation in group.relationsList) {
      val data = getRelationData(relation, block.stringtable)
      if (data.name == null) {
        continue
      }
      if (!RelationCategory.TRAIL.isParentOf(data.type)) {
        continue
      }

      val ways = ArrayList<Long>()
      if (!flattenToWays(relation.id, relations, ways)) {
        ways.clear()
      }

      csv.append(TRAIL_FROM_RELATION_OFFSET + relation.id)
      csv.append(",")
      csv.append(data.type.id)
      csv.append(",-1,")
      csv.append(escapeCsv(data.name))
      csv.append(",")

      val copied = ByteBuffer.allocate(ways.size * 8).order(ByteOrder.LITTLE_ENDIAN)
      ways.forEach { copied.putLong(2 * it) }
      appendByteArray(copied.array(), csv)

      csv.append(",0,0,0,0,,")
      csv.append(relation.id)
      csv.append(",,1")
      csv.append("\n")
    }
  }
}

fun flattenToWays(id: Long, relations: Map<Long, ByteString>, ways: MutableList<Long>): Boolean {
  val relationBytes = relations[id] ?: return false
  for (member in RelationSkeleton.parseFrom(relationBytes).membersList) {
    when (member.valueCase) {
      NODE_ID -> return false
      RELATION_ID -> {
        if (!flattenToWays(member.relationId, relations, ways)) {
          return false
        }
      }
      WAY_ID -> ways.add(member.wayId)
      else -> throw AssertionError()
    }
  }
  return true
}

fun polylineToMeters(polyline: S2Polyline): Double {
  return polyline.arclengthAngle.radians() * 6371010.0
}
