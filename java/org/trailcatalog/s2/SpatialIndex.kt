package org.trailcatalog.s2

import com.google.common.geometry.S2CellId
import com.google.common.geometry.S2CellUnion
import com.google.common.geometry.S2LatLngRect
import com.google.common.geometry.S2RegionCoverer

fun boundToCell(bound: S2LatLngRect): S2CellId {
  val covering =
    S2RegionCoverer.builder()
        .setMaxLevel(SimpleS2.HIGHEST_INDEX_LEVEL)
        .build()
        .getCovering(bound)
  var containedBy =
    S2CellId.fromLatLng(bound.center)
        .parent(SimpleS2.HIGHEST_INDEX_LEVEL)
  val neighbors = ArrayList<S2CellId>()
  val union = S2CellUnion()
  while (containedBy.level() > 0) {
    neighbors.clear()
    neighbors.add(containedBy)
    containedBy.getAllNeighbors(containedBy.level(), neighbors)
    union.initFromCellIds(neighbors)
    if (union.contains(covering)) {
      return containedBy
    } else {
      containedBy = containedBy.parent()
    }
  }
  throw IllegalStateException("${bound} contained by any cell")
}