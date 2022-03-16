package org.trailcatalog.pbf

import com.google.common.geometry.S2Polyline
import crosby.binary.Osmformat.PrimitiveBlock
import crosby.binary.Osmformat.PrimitiveGroup
import java.nio.charset.StandardCharsets
import org.apache.commons.text.StringEscapeUtils.escapeCsv
import org.trailcatalog.models.RelationCategory
import java.nio.ByteBuffer
import java.nio.ByteOrder

class TrailsCsvInputStream(

  private val relationWays: Map<Long, ByteArray>,
  block: PrimitiveBlock)
  : PbfEntityInputStream(
    block,
    "id,type,cell,name,path_ids,elevation_delta_meters,length_meters,source_relation,source_way\n".toByteArray(StandardCharsets.UTF_8),
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

      val ways = relationWays[relation.id]

      csv.append(TRAIL_FROM_RELATION_OFFSET + relation.id)
      csv.append(",")
      csv.append(data.type.id)
      csv.append(",-1,")
      csv.append(escapeCsv(data.name))
      csv.append(",")
      if (ways == null) {
        csv.append("\\x")
      } else {
        val copied = ByteBuffer.allocate(ways.size).order(ByteOrder.LITTLE_ENDIAN)
        copied.put(ways)
        copied.asLongBuffer().let {
          for (i in 0 until it.capacity()) {
            it.put(i, 2 * it.get(i))
          }
        }
        appendByteArray(copied.array(), csv)
      }
      csv.append(",0,0,")
      csv.append(relation.id)
      csv.append(",")
      csv.append("\n")
    }

    for (way in group.waysList) {
      val data = getWayData(way, block.stringtable)
      if (data.name == null) {
        continue
      }
      val asRelationType = PATHS_TO_TRAILS[data.type] ?: continue
      val bytes = ByteBuffer.allocate(8).order(ByteOrder.LITTLE_ENDIAN)
      bytes.asLongBuffer().put(way.id * 2)

      csv.append(TRAIL_FROM_WAY_OFFSET + way.id)
      csv.append(",")
      csv.append(asRelationType.id)
      csv.append(",-1,")
      csv.append(escapeCsv(data.name))
      csv.append(",")
      appendByteArray(bytes.array(), csv)
      csv.append(",0,0,")
      csv.append(",")
      csv.append(way.id)
      csv.append("\n")
    }
  }
}

fun polylineToMeters(polyline: S2Polyline): Double {
  return polyline.arclengthAngle.radians() * 6371010.0
}