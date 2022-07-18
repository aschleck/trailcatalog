package org.trailcatalog.importers.pbf

import com.google.common.reflect.TypeToken
import org.trailcatalog.importers.pipeline.PMapTransformer
import org.trailcatalog.importers.pipeline.collections.Emitter2
import org.trailcatalog.importers.pipeline.collections.PEntry

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
    for (node in way.nodes) {
      geometry.add(mapped[node] ?: return)
    }
    emitter.emit(way.id, Way(way.id, way.version, way.type, way.name, geometry))
  }

  override fun estimateRatio(): Double {
    return 0.5
  }
}
