package org.trailcatalog.pbf

import com.google.protobuf.ByteString
import crosby.binary.Osmformat.PrimitiveBlock
import crosby.binary.Osmformat.PrimitiveGroup
import org.trailcatalog.models.RelationCategory
import java.nio.charset.StandardCharsets

class PathsInTrailsCsvInputStream(

    private val relations: Map<Long, ByteString>,
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

      val ways = ArrayList<Long>()
      if (!flattenToWays(relation.id, relations, ways)) {
        continue
      }

      val seen = HashSet<Long>()
      for (id in ways) {
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

    // This inserts members for when we seed trails from paths
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
