package org.trailcatalog.importers.basemap

import com.google.common.reflect.TypeToken
import org.trailcatalog.importers.pipeline.PMapTransformer
import org.trailcatalog.importers.pipeline.collections.Emitter2
import org.trailcatalog.importers.pipeline.collections.PEntry

// The boundaries of each type that hold most of a trail, or else the one holding the most so that
// a trail through three countries still keeps one. Boundaries of one type can overlap, like a
// département and its diocese, so several may stay.
class ResolveTrailBoundaries : PMapTransformer<PEntry<Long, Pair<Boundary, Int>>, Long, Boundary>(
    "ResolveTrailBoundaries", TypeToken.of(Long::class.java), TypeToken.of(Boundary::class.java)) {

  override fun act(input: PEntry<Long, Pair<Boundary, Int>>, emitter: Emitter2<Long, Boundary>) {
    for ((_, candidates) in input.values.groupBy { it.first.type }) {
      val majority = candidates.filter { it.second > 0 }
      if (majority.isEmpty()) {
        emitter.emit(input.key, candidates.maxBy { it.second }.first)
      } else {
        majority.forEach { emitter.emit(input.key, it.first) }
      }
    }
  }

  // We only drop candidates, and most trails have one candidate of each type.
  override fun estimateRatio(): Double {
    return 1.0
  }
}
