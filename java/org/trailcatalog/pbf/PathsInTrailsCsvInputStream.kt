package org.trailcatalog.pbf

import crosby.binary.Osmformat.PrimitiveBlock
import crosby.binary.Osmformat.PrimitiveGroup
import org.trailcatalog.models.RelationCategory
import java.nio.charset.StandardCharsets
import java.nio.ByteBuffer
import java.nio.ByteOrder

class PathsInTrailsCsvInputStream(

  private val relationWays: Map<Long, ByteArray>,
  block: PrimitiveBlock)
  : PbfEntityInputStream(
    block,
    "path_id,trail_id\n".toByteArray(StandardCharsets.UTF_8),
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

      val ways = relationWays[relation.id] ?: continue

      val allWayIds = ByteBuffer.wrap(ways).order(ByteOrder.LITTLE_ENDIAN).asLongBuffer()
      val seen = HashSet<Long>()
      while (allWayIds.hasRemaining()) {
        val id = allWayIds.get()
        if (seen.contains(id)) {
          continue
        }
        seen.add(id)
        csv.append(id * 2)
        csv.append(",")
        csv.append(TRAIL_FROM_RELATION_OFFSET + relation.id)
        csv.append("\n")
      }
    }

    for (way in group.waysList) {
      val data = getWayData(way, block.stringtable)
      if (data.name == null) {
        continue
      }
      PATHS_TO_TRAILS[data.type] ?: continue

      csv.append(way.id * 2)
      csv.append(",")
      csv.append(TRAIL_FROM_WAY_OFFSET + way.id)
      csv.append("\n")
    }
  }
}
