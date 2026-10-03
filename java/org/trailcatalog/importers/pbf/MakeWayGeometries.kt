package org.trailcatalog.importers.pbf

import com.google.common.reflect.TypeToken
import org.trailcatalog.importers.pipeline.PMapTransformer
import org.trailcatalog.importers.pipeline.collections.Emitter2
import org.trailcatalog.importers.pipeline.collections.PEntry
import org.trailcatalog.models.PointCategory

class MakeWayGeometries
  : PMapTransformer<PEntry<Long, Pair<List<WaySkeleton>, List<Node>>>, Long, Way>(
    "MakeWayGeometries",
    TypeToken.of(Long::class.java),
    TypeToken.of(Way::class.java),
  ) {

  override fun act(
      input: PEntry<Long, Pair<List<WaySkeleton>, List<Node>>>, emitter: Emitter2<Long, Way>) {
    val way = input.values.stream().flatMap { it.first.stream() }.findFirst().orElse(null) ?: return

    val mapped = HashMap<Long, LatLngE7>()
    for (value in input.values) {
      for (node in value.second) {
        mapped[node.id] = node.latLng
      }
    }

    val geometry = ArrayList<LatLngE7>()
    var hash = 0
    for (id in way.nodes) {
      val node = mapped[id] ?: return
      hash = 31 * hash + node.lat
      hash = 31 * hash + node.lng
      geometry.add(node)
    }
    val point =
        if (way.pointType != PointCategory.ANY.id) {
          WayPoint(way.pointType, way.name, way.names, way.notable)
        } else {
          null
        }
    emitter.emit(
        way.id, Way(way.id, hash, way.type, Float.NaN, Float.NaN, Float.NaN, geometry, point))
  }

  override fun estimateRatio(): Double {
    return 0.5
  }
}
