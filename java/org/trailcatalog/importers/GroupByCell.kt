package org.trailcatalog.importers

import com.google.common.geometry.S1Angle
import com.google.common.geometry.S2CellId
import com.google.common.geometry.S2CellUnion
import com.google.common.geometry.S2Polygon
import com.google.common.geometry.S2Polyline
import com.google.common.geometry.S2Projections
import com.google.common.reflect.TypeToken
import org.trailcatalog.importers.pipeline.PMapTransformer
import org.trailcatalog.importers.pipeline.collections.Emitter2
import org.trailcatalog.s2.boundToCell
import java.io.ByteArrayInputStream

private const val CONTAINMENT_CELL_LEVEL = 9
private const val SNAP_CELL_LEVEL = 24

data class BoundaryPolygon(val id: Long, val polygon: S2Polygon)
data class TrailPolyline(val id: Long, val polyline: S2Polyline)

class GroupBoundariesByCell
  : PMapTransformer<
    Boundary,
    Long,
    BoundaryPolygon>(
    "GroupBoundariesByCell",
    TypeToken.of(Long::class.java),
    TypeToken.of(BoundaryPolygon::class.java)) {

  override fun act(
      input: Boundary,
      emitter: Emitter2<Long, BoundaryPolygon>) {
    val unsnapped = S2Polygon.decode(ByteArrayInputStream(input.s2Polygon))
    val snapped = S2Polygon().also {
      it.initToSimplified(
          unsnapped,
          S1Angle.radians(S2Projections.PROJ.maxDiag.getValue(SNAP_CELL_LEVEL) / 2.0 + 1e-15),
          /* snapToCellCenters= */ true)
    }
    val output = BoundaryPolygon(input.id, snapped)
    for (cell in getIntersectingContainmentCells(S2CellId(input.cell))) {
      emitter.emit(cell.id(), output)
    }
  }
}

class GroupTrailsByCell
  : PMapTransformer<
    Trail,
    Long,
    TrailPolyline>(
      "GroupTrailsByCell",
      TypeToken.of(Long::class.java),
      TypeToken.of(TrailPolyline::class.java)) {

  override fun act(
      input: Trail,
      emitter: Emitter2<Long, TrailPolyline>) {
    val snapped = S2Polyline.fromSnapped(input.polyline, SNAP_CELL_LEVEL)
    val output = TrailPolyline(input.relationId, snapped)
    for (cell in getIntersectingContainmentCells(boundToCell(input.polyline.rectBound))) {
      emitter.emit(cell.id(), output)
    }
  }
}

private fun getIntersectingContainmentCells(cell: S2CellId): ArrayList<S2CellId> {
  val union = S2CellUnion()
  union.initFromCellIds(
      arrayListOf(
          if (cell.level() <= CONTAINMENT_CELL_LEVEL) {
            cell
          } else {
            cell.parent(CONTAINMENT_CELL_LEVEL)
          }))
  union.expand(CONTAINMENT_CELL_LEVEL)
  val relevant = ArrayList<S2CellId>()
  union.denormalize(CONTAINMENT_CELL_LEVEL, /* levelMod= */ 1, relevant)
  return relevant
}
