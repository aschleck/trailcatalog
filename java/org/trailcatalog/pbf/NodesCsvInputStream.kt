package org.trailcatalog.pbf

import crosby.binary.Osmformat.PrimitiveBlock
import crosby.binary.Osmformat.PrimitiveGroup
import java.nio.charset.StandardCharsets

class NodesCsvInputStream(block: PrimitiveBlock) : PbfEntityInputStream(
    block,
    "id,lat_degrees,lng_degrees\n".toByteArray(StandardCharsets.UTF_8),
) {

  override fun convertToCsv(value: PrimitiveGroup, csv: StringBuilder) {
    for (node in value.nodesList) {
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
    for (index in 0 until value.dense.idCount) {
      denseId += value.dense.idList[index]
      denseLat += value.dense.latList[index]
      denseLon += value.dense.lonList[index]

      val latDegrees = (block.latOffset + block.granularity * denseLat) * NANO
      val lngDegrees = (block.lonOffset + block.granularity * denseLon) * NANO
      csv.append(denseId)
      csv.append(",")
      csv.append(latDegrees)
      csv.append(",")
      csv.append(lngDegrees)
      csv.append("\n")
    }
  }
}