package org.trailcatalog.importers.pbf

import com.google.common.geometry.S2Loop
import com.google.common.geometry.S2Point
import com.google.common.reflect.TypeToken
import org.trailcatalog.importers.pipeline.PTransformer
import org.trailcatalog.importers.pipeline.collections.Emitter
import org.trailcatalog.importers.pipeline.collections.PEntry
import org.trailcatalog.models.PointCategory

/** Collapses each closed way with a point type to a point at its centroid. */
class MakeWayPoints
  : PTransformer<PEntry<Long, Pair<List<WaySkeleton>, List<Node>>>, Point>(
    TypeToken.of(Point::class.java)) {

  override fun act(
      input: PEntry<Long, Pair<List<WaySkeleton>, List<Node>>>, emitter: Emitter<Point>) {
    val way = input.values.stream().flatMap { it.first.stream() }.findFirst().orElse(null) ?: return
    if (way.pointType == PointCategory.ANY.id) {
      return
    }

    val mapped = HashMap<Long, LatLngE7>()
    for (value in input.values) {
      for (node in value.second) {
        mapped[node.id] = node.latLng
      }
    }

    // The last node repeats the first, and S2Loop wants each vertex once.
    val vertices = ArrayList<S2Point>()
    for (i in 0 until way.nodes.size - 1) {
      val node = mapped[way.nodes[i]] ?: return
      vertices.add(node.toS2LatLng().toPoint())
    }
    val loop = S2Loop(vertices)
    // A clockwise way would otherwise be the loop around the rest of the planet.
    loop.normalize()
    emitter.emit(
        Point(
            wayPointId(way.id),
            way.pointType,
            way.name.ifEmpty { null },
            way.names,
            LatLngE7.fromS2Point(loop.centroid)))
  }

  // Only ways with a point type emit, and they're a sliver of the ways that reach the join.
  override fun estimateRatio(): Double {
    return 0.01
  }
}
