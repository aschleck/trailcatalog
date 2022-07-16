package org.trailcatalog.s2

import com.google.common.geometry.S2CellId
import com.google.common.geometry.S2CellUnion
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

  // Relation 8907468 gets marked as full in both directions for some reason. Not clear why but the
  // logic of just picking a face cell makes sense regardless.
  return S2CellId.fromFace(0)
}

fun polygonToCell(polygon: S2Polygon): S2CellId {
  val covering =
    S2RegionCoverer.builder()
        .setMaxLevel(SimpleS2.HIGHEST_INDEX_LEVEL)
        .build()
        .getCovering(polygon)
  var containedBy =
    S2CellId.fromPoint(polygon.centroid)
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
  return S2CellId.fromFace(0)
}

fun polylineToCell(polyline: S2Polyline): S2CellId {
  val covering =
    S2RegionCoverer.builder()
        .setMaxLevel(SimpleS2.HIGHEST_INDEX_LEVEL)
        .build()
        .getCovering(polyline)
  var containedBy =
    S2CellId.fromPoint(polyline.interpolate(0.5))
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
  return S2CellId.fromFace(0)
}

