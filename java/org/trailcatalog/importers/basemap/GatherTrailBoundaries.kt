package org.trailcatalog.importers.basemap

import com.google.common.reflect.TypeToken
import org.trailcatalog.importers.pipeline.PMapTransformer
import org.trailcatalog.importers.pipeline.collections.Emitter2
import org.trailcatalog.importers.pipeline.collections.PEntry

class GatherTrailBoundaries : PMapTransformer<PEntry<Long, Pair<List<Boundary>, List<Long>>>, Long, Boundary>(
    "GatherTrailBoundaries", TypeToken.of(Long::class.java), TypeToken.of(Boundary::class.java)) {

  override fun act(input: PEntry<Long, Pair<List<Boundary>, List<Long>>>, emitter: Emitter2<Long, Boundary>) {
    for (value in input.values) {
      if (value.first.isEmpty()) {
        continue
      }

      val boundary = value.first[0]
      for (trail in value.second) {
        emitter.emit(trail, boundary)
      }
    }
  }

  override fun estimateRatio(): Double {
    return 1.0
  }
}
