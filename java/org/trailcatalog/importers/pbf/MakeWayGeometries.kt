package org.trailcatalog.importers.pbf

import com.google.common.reflect.TypeToken
import org.trailcatalog.importers.pipeline.PMapTransformer
import org.trailcatalog.importers.pipeline.collections.Emitter2
import org.trailcatalog.importers.pipeline.collections.PEntry

class MakeWayGeometries
  : PMapTransformer<PEntry<Long, Pair<List<Way>, List<Node>>>, Long, List<LatLngE7>>(
    TypeToken.of(Long::class.java), object : TypeToken<List<LatLngE7>>() {}) {

  override fun act(
      input: PEntry<Long, Pair<List<Way>, List<Node>>>, emitter: Emitter2<Long, List<LatLngE7>>) {
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
    emitter.emit(way.id, geometry)
  }

  override fun estimateRatio(): Double {
    return 1.0
  }
}
