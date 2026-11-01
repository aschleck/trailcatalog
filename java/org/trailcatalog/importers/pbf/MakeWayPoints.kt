package org.trailcatalog.importers.pbf

import com.google.common.geometry.S2Loop
import com.google.common.geometry.S2Point
import com.google.common.geometry.S2Polygon
import com.google.common.reflect.TypeToken
import org.trailcatalog.importers.pipeline.PTransformer
import org.trailcatalog.importers.pipeline.collections.Emitter
import org.trailcatalog.importers.pipeline.collections.PEntry
import org.trailcatalog.models.PointCategory
import org.trailcatalog.models.wayPointId

/**
 * Collapses each closed way with a point type to a point inside it, and each climbing route to a
 * point at its bottom.
 */
class MakeWayPoints : PTransformer<PEntry<Long, Way>, Point>(TypeToken.of(Point::class.java)) {

  override fun act(input: PEntry<Long, Way>, emitter: Emitter<Point>) {
    val way = input.values[0]
    val point = way.point ?: return
    if (point.type == PointCategory.CLIMBING_ROUTE.id) {
      emit(way, point, /* rank= */ null, way.points[0], emitter)
      return
    }

    // The last point repeats the first, and S2Loop wants each vertex once.
    val vertices = ArrayList<S2Point>()
    for (i in 0 until way.points.size - 1) {
      vertices.add(way.points[i].toS2LatLng().toPoint())
    }
    val loop = S2Loop(vertices)
    // A clockwise way would otherwise be the loop around the rest of the planet.
    loop.normalize()
    val polygon = S2Polygon(loop)
    val at = interiorPoint(polygon)
    val rank = if (isRankedArea(point.type)) getAreaRank(polygon, at) else null
    emit(way, point, rank, LatLngE7.fromS2Point(at), emitter)
  }

  private fun emit(
      way: Way, point: WayPoint, rank: Int?, at: LatLngE7, emitter: Emitter<Point>) {
    emitter.emit(
        Point(
            wayPointId(way.id),
            point.type,
            point.name.ifEmpty { null },
            point.names,
            point.notable,
            rank,
            at))
  }

  // Only ways with a point type emit, and they're a sliver of the ways with geometry.
  override fun estimateRatio(): Double {
    return 0.01
  }
}
