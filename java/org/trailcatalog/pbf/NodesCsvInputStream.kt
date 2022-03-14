package org.trailcatalog.pbf

import crosby.binary.Osmformat.PrimitiveBlock
import crosby.binary.Osmformat.PrimitiveGroup
import java.nio.charset.StandardCharsets

class NodesCsvInputStream(block: PrimitiveBlock) : PbfEntityInputStream(
    block,
    "id,lat_degrees,lng_degrees\n".toByteArray(StandardCharsets.UTF_8),
) {

  override fun convertToCsv(group: PrimitiveGroup, csv: StringBuilder) {
    for (node in group.nodesList) {
      val latDegrees = (block.latOffset + block.granularity * node.lat) * NANO
      val lngDegrees = (block.lonOffset + block.granularity * node.lon) * NANO
      csv.append(node.id)
      csv.append(",")
      csv.append(latDegrees)
      csv.append(",")
      csv.append(lngDegrees)
      csv.append("\n")
    }

    var denseId = 0L
    var denseLat = 0L
    var denseLon = 0L
    for (index in 0 until group.dense.idCount) {
      denseId += group.dense.idList[index]
      denseLat += group.dense.latList[index]
      denseLon += group.dense.lonList[index]

      val latDegrees = (block.latOffset + block.granularity * denseLat) * org.trailcatalog.pbf.NANO
      val lngDegrees = (block.lonOffset + block.granularity * denseLon) * org.trailcatalog.pbf.NANO
      csv.append(denseId)
      csv.append(",")
      csv.append(latDegrees)
      csv.append(",")
      csv.append(lngDegrees)
      csv.append("\n")
    }
  }
}