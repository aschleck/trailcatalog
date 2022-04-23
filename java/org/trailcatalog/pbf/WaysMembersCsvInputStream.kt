package org.trailcatalog.pbf

import crosby.binary.Osmformat.PrimitiveBlock
import crosby.binary.Osmformat.PrimitiveGroup
import java.nio.charset.StandardCharsets

class WaysMembersCsvInputStream(block: PrimitiveBlock) : PbfEntityInputStream(
    block,
    "way_id,node_id\n".toByteArray(StandardCharsets.UTF_8),
) {

  override fun convertToCsv(group: PrimitiveGroup, csv: StringBuilder) {
    for (way in group.waysList) {
      var nodeId = 0L
      val seen = HashSet<Long>()
      for (delta in way.refsList) {
        nodeId += delta

        if (seen.contains(nodeId)) {
          continue
        } else {
          seen.add(nodeId)
        }

        csv.append(way.id)
        csv.append(",")
        csv.append(nodeId)
        csv.append("\n")
      }
    }
  }
}
