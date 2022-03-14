package org.trailcatalog.pbf

import crosby.binary.Osmformat.PrimitiveBlock
import crosby.binary.Osmformat.PrimitiveGroup
import crosby.binary.Osmformat.Relation
import crosby.binary.Osmformat.StringTable
import java.nio.charset.StandardCharsets
import org.apache.commons.text.StringEscapeUtils.escapeCsv

class RelationsCsvInputStream(block: PrimitiveBlock) : PbfEntityInputStream(
    block,
    "id,type,name\n".toByteArray(StandardCharsets.UTF_8),
) {

  override fun convertToCsv(group: PrimitiveGroup, csv: StringBuilder) {
    for (relation in group.relationsList) {
      val data = getRelationData(relation, block.stringtable)
      csv.append(relation.id)
      csv.append(",")
      csv.append(data.type.id)
      csv.append(",")
      if (data.name != null) {
        csv.append(escapeCsv(data.name))
      }
      csv.append("\n")
    }
  }
}

data class RelationData(
  val type: RelationCategory,
  val name: String?,
)

fun getRelationData(relation: Relation, stringTable: StringTable): RelationData {
  var category = RelationCategory.ANY
  var name: String? = null
  var network: String? = null
  var ref: String? = null
  for (i in 0 until relation.keysCount) {
    val key = relation.getKeys(i)
    when (stringTable.getS(key)) {
      ADMIN_LEVEL_BS ->
        category = category.coerceAtLeast(ADMINISTRATIVE_LEVEL_NAMES[stringTable.getS(relation.getVals(i))])
      BOUNDARY_BS ->
        category = category.coerceAtLeast(BOUNDARY_CATEGORY_NAMES[stringTable.getS(relation.getVals(i))])
      NAME_BS ->
        name = stringTable.getS(relation.getVals(i)).toStringUtf8()
      NETWORK_BS ->
        network = stringTable.getS(relation.getVals(i)).toStringUtf8()
      PROTECT_CLASS_BS ->
        category = category.coerceAtLeast(PROTECT_CLASS_NAMES[stringTable.getS(relation.getVals(i))])
      REF_BS ->
        ref = stringTable.getS(relation.getVals(i)).toStringUtf8()
      ROUTE_BS ->
        category = category.coerceAtLeast(ROUTE_CATEGORY_NAMES[stringTable.getS(relation.getVals(i))])
    }
  }
  if (name == null && network != null && ref != null) {
    name = "${network} ${ref}"
  }
  return RelationData(type = category, name = name)
}
