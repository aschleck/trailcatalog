package org.trailcatalog.importers

import com.google.common.geometry.S1Angle
import com.google.common.geometry.S2CellId
import com.google.common.geometry.S2CellUnion
import com.google.common.geometry.S2Polygon
import com.google.common.geometry.S2Polyline
import com.google.common.geometry.S2Projections
import com.google.common.geometry.S2RegionCoverer
import com.google.common.reflect.TypeToken
import org.trailcatalog.importers.pipeline.PMapTransformer
import org.trailcatalog.importers.pipeline.collections.Emitter2
import org.trailcatalog.s2.polylineToCell
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import kotlin.math.min

private const val CONTAINMENT_CELL_LEVEL = 8
private const val SNAP_CELL_LEVEL = 22

data class BoundaryPolygon(val id: Long, val polygon: ByteArray)
data class TrailPolyline(val id: Long, val polyline: ByteArray)

private val COVERER =
    S2RegionCoverer.builder().setMaxCells(1000).setMaxLevel(SNAP_CELL_LEVEL).build()

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
    val polygon = S2Polygon.decode(ByteArrayInputStream(input.s2Polygon))
    val covering = COVERER.getCovering(polygon)
    val encoded = ByteArrayOutputStream().also {
      covering.encode(it)
    }
    val output = BoundaryPolygon(input.id, encoded.toByteArray())
    for (cell in intersectingContainmentCells(S2CellId(input.cell))) {
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
    val covering = COVERER.getCovering(input.polyline)
    val encoded = ByteArrayOutputStream().also {
      covering.encode(it)
    }
    val output = TrailPolyline(input.relationId, encoded.toByteArray())
    for (cell in intersectingContainmentCells(polylineToCell(input.polyline))) {
      emitter.emit(cell.id(), output)
    }
  }
}

private fun intersectingContainmentCells(base: S2CellId) = sequence<S2CellId> {
  val union = S2CellUnion()
  union.initRawCellIds(
      arrayListOf(
          if (base.level() <= CONTAINMENT_CELL_LEVEL) {
            base
          } else {
            base.parent(CONTAINMENT_CELL_LEVEL)
          }))
  union.expand(min(base.level(), CONTAINMENT_CELL_LEVEL))
  for (cell in union) {
    if (cell.level() < CONTAINMENT_CELL_LEVEL) {
      for (child in cell.childrenAtLevel(CONTAINMENT_CELL_LEVEL)) {
        yield(child)
      }
    } else {
      yield(cell)
    }
  }
}
