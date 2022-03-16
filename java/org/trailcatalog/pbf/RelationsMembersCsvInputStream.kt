package org.trailcatalog.pbf

import crosby.binary.Osmformat.PrimitiveBlock
import crosby.binary.Osmformat.PrimitiveGroup
import crosby.binary.Osmformat.Relation.MemberType
import java.nio.charset.StandardCharsets

class RelationsMembersCsvInputStream(
    private val type: MemberType,
    block: PrimitiveBlock,
) : PbfEntityInputStream(
    block,
    "parent,child\n".toByteArray(StandardCharsets.UTF_8),
) {

  override fun convertToCsv(group: PrimitiveGroup, csv: StringBuilder) {
    for (relation in group.relationsList) {
      var memberId = 0L
      val seen = HashSet<Long>()
      for (i in 0 until relation.memidsCount) {
        memberId += relation.getMemids(i)

        if (relation.getTypes(i) == type) {
          if (seen.contains(memberId)) {
            continue
          } else {
            seen.add(memberId)
          }

          csv.append(relation.id)
          csv.append(",")
          csv.append(memberId)
          csv.append("\n")
        }
      }
    }
  }
}