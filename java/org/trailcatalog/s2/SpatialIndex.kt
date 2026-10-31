package org.trailcatalog.s2

import com.google.common.geometry.S2CellId
import com.google.common.geometry.S2CellUnion
import com.google.common.geometry.S2LatLng
import com.google.common.geometry.S2LatLngRect
import com.google.common.geometry.S2Polyline
import com.google.common.geometry.S2Polygon
import com.google.common.geometry.S2RegionCoverer

fun boundToCell(bound: S2LatLngRect): S2CellId {
  val covering =
    S2RegionCoverer.builder()
        .setMaxLevel(SimpleS2.HIGHEST_INDEX_LEVEL)
        .build()
        .getCovering(bound)
  return containingCell(S2CellId.fromLatLng(bound.center), covering)
}

fun latLngToCell(latLng: S2LatLng): S2CellId {
  return S2CellId.fromLatLng(latLng).parent(SimpleS2.HIGHEST_INDEX_LEVEL)
}

fun polygonToCell(polygon: S2Polygon): S2CellId {
  val covering =
    S2RegionCoverer.builder()
        .setMaxLevel(SimpleS2.HIGHEST_INDEX_LEVEL)
        .build()
        .getCovering(polygon)
  return containingCell(S2CellId.fromPoint(polygon.centroid), covering)
}

fun polylineToCell(polyline: S2Polyline): S2CellId {
  val covering = S2CellUnion()
  covering.initFromCellIds(ArrayList<S2CellId>().also {
    for (v in 0 until polyline.numVertices()) {
      it.add(S2CellId.fromPoint(polyline.vertex(v)).parent(SimpleS2.HIGHEST_INDEX_LEVEL))
    }
  })

  return containingCell(S2CellId.fromPoint(polyline.interpolate(0.5)), covering)
}

private fun containingCell(start: S2CellId, covering: S2CellUnion): S2CellId {
  var containedBy = start.parent(SimpleS2.HIGHEST_INDEX_LEVEL)
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

  // Relation 8907468 gets marked as full in both directions for some reason. Not clear why but the
  // logic of just picking a face cell makes sense regardless.
  return S2CellId.fromFace(0)
}
