package org.trailcatalog.importers.pbf

import com.google.common.geometry.S2Loop
import com.google.common.geometry.S2Point
import com.google.common.reflect.TypeToken
import org.trailcatalog.importers.pipeline.PTransformer
import org.trailcatalog.importers.pipeline.collections.Emitter
import org.trailcatalog.importers.pipeline.collections.PEntry

/** Collapses each closed way with a point type to a point at its centroid. */
class MakeWayPoints : PTransformer<PEntry<Long, Way>, Point>(TypeToken.of(Point::class.java)) {

  override fun act(input: PEntry<Long, Way>, emitter: Emitter<Point>) {
    val way = input.values[0]
    val point = way.point ?: return

    // The last point repeats the first, and S2Loop wants each vertex once.
    val vertices = ArrayList<S2Point>()
    for (i in 0 until way.points.size - 1) {
      vertices.add(way.points[i].toS2LatLng().toPoint())
    }
    val loop = S2Loop(vertices)
    // A clockwise way would otherwise be the loop around the rest of the planet.
    loop.normalize()
    emitter.emit(
        Point(
            wayPointId(way.id),
            point.type,
            point.name.ifEmpty { null },
            point.names,
            point.notable,
            LatLngE7.fromS2Point(loop.centroid)))
  }

  // Only ways with a point type emit, and they're a sliver of the ways with geometry.
  override fun estimateRatio(): Double {
    return 0.01
  }
}
