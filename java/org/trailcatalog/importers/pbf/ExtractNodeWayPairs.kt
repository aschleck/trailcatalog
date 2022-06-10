package org.trailcatalog.importers.pbf

import com.google.common.reflect.TypeToken
import org.trailcatalog.importers.pipeline.PMapTransformer
import org.trailcatalog.importers.pipeline.collections.Emitter2
import org.trailcatalog.importers.pipeline.collections.PEntry

class ExtractNodeWayPairs : PMapTransformer<PEntry<Long, WaySkeleton>, Long, Long>(
    "ExtractNodeWayPairs",
    TypeToken.of(Long::class.java),
    TypeToken.of(Long::class.java)) {

  override fun act(input: PEntry<Long, WaySkeleton>, emitter: Emitter2<Long, Long>) {
    val way = input.values[0]
    for (nodeId in way.nodes) {
      emitter.emit(nodeId, way.id)
    }
  }

  override fun estimateRatio(): Double {
    return 1.0
  }
}
