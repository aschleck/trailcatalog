package org.trailcatalog.importers.basemap

import com.google.common.reflect.TypeToken
import org.trailcatalog.importers.pbf.AREA_TYPES
import org.trailcatalog.importers.pbf.LatLngE7
import org.trailcatalog.importers.pbf.Point
import org.trailcatalog.importers.pbf.Way
import org.trailcatalog.importers.pbf.WayPoint
import org.trailcatalog.importers.pbf.getAreaRank
import org.trailcatalog.importers.pbf.interiorPoint
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

    val polygon = closedWayToPolygon(way)
    if (polygon.isEmpty) {
      return
    }
    val at = interiorPoint(polygon)
    val rank = if (point.type in AREA_TYPES) getAreaRank(polygon, at) else null
    emit(way, point, rank, LatLngE7.fromS2Point(at), emitter)
  }

  private fun emit(
      way: Way, point: WayPoint, rank: Int?, at: LatLngE7, emitter: Emitter<Point>) {
    emitter.emit(
        Point(
            wayPointId(way.id),
            point.type,
            point.name.ifEmpty { null },
            // See PARK_POINT_CATEGORIES
            if (PointCategory.PARK.isParentOf(point.type)) listOf() else point.names,
            point.notable,
            rank,
            at))
  }

  // Only ways with a point type emit, and they're a sliver of the ways with geometry.
  override fun estimateRatio(): Double {
    return 0.01
  }
}
