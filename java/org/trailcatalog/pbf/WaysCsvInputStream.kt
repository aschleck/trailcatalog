package org.trailcatalog.pbf

import crosby.binary.Osmformat.PrimitiveBlock
import crosby.binary.Osmformat.PrimitiveGroup
import crosby.binary.Osmformat.StringTable
import crosby.binary.Osmformat.Way
import java.nio.charset.StandardCharsets
import org.apache.commons.text.StringEscapeUtils.escapeCsv

class WaysCsvInputStream(block: PrimitiveBlock) : PbfEntityInputStream(
    block,
    "id,type,name\n".toByteArray(StandardCharsets.UTF_8),
) {

  override fun convertToCsv(group: PrimitiveGroup, csv: StringBuilder) {
    for (way in group.waysList) {
      val data = getWayData(way, block.stringtable)
      csv.append(way.id)
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

data class WayData(
  val type: WayCategory,
  val name: String?,
)

fun getWayData(way: Way, stringTable: StringTable): WayData {
  var category = WayCategory.ANY
  var name: String? = null
  for (i in 0 until way.keysCount) {
    when (stringTable.getS(way.getKeys(i))) {
      HIGHWAY_BS ->
        category = category.coerceAtLeast(HIGHWAY_CATEGORY_NAMES[stringTable.getS(way.getVals(i))])
      NAME_BS ->
        name = stringTable.getS(way.getVals(i)).toStringUtf8()
    }
  }
  return WayData(type = category, name = name)
}
