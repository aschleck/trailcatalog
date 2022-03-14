package org.trailcatalog.pbf

import com.google.common.geometry.S2LatLng
import com.google.common.geometry.S2Point
import com.google.common.geometry.S2Polyline
import crosby.binary.Osmformat.PrimitiveBlock
import crosby.binary.Osmformat.PrimitiveGroup
import java.nio.charset.StandardCharsets
import org.apache.commons.text.StringEscapeUtils.escapeCsv
import org.trailcatalog.s2.boundToCell
import java.nio.ByteBuffer
import java.nio.ByteOrder

class TrailsCsvInputStream(

  private val nodes: Map<Long, Pair<Double, Double>>,
  private val relations: Map<Long, ByteArray>,
  block: PrimitiveBlock)
  : PbfEntityInputStream(
    block,
    "id,type,cell,name,elevation_delta_meters,length_meters,source_relation,source_way\n".toByteArray(StandardCharsets.UTF_8),
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

      val allNodeIds =
          ByteBuffer.wrap(relations[relation.id]).order(ByteOrder.LITTLE_ENDIAN).asLongBuffer()
      val points = ArrayList<S2Point>()
      while (allNodeIds.hasRemaining()) {
        val point = nodes[allNodeIds.get()]!!
        points.add(S2LatLng.fromDegrees(point.first, point.second).toPoint())
      }
      val polyline = S2Polyline(points)

      csv.append(TRAIL_FROM_RELATION_OFFSET + relation.id)
      csv.append(",")
      csv.append(data.type)
      csv.append(",")
      csv.append(boundToCell(polyline.rectBound))
      csv.append(",")
      csv.append(escapeCsv(data.name))
      csv.append(",")
      csv.append(0)
      csv.append(",")
      csv.append(polylineToMeters(polyline))
      csv.append(",")
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

      val points = ArrayList<S2Point>()
      var nodeId = 0L
      for (delta in way.refsList) {
        nodeId += delta
        val point = nodes[nodeId]!!
        points.add(S2LatLng.fromDegrees(point.first, point.second).toPoint())
      }
      val polyline = S2Polyline(points)

      csv.append(TRAIL_FROM_WAY_OFFSET + way.id)
      csv.append(",")
      csv.append(asRelationType)
      csv.append(",")
      csv.append(boundToCell(polyline.rectBound))
      csv.append(",")
      csv.append(escapeCsv(data.name))
      csv.append(",")
      csv.append(0)
      csv.append(",")
      csv.append(polylineToMeters(polyline))
      csv.append(",")
      csv.append(",")
      csv.append(way.id)
      csv.append("\n")
    }
  }
}

fun polylineToMeters(polyline: S2Polyline): Double {
  return polyline.arclengthAngle.radians() * 6371010.0
}