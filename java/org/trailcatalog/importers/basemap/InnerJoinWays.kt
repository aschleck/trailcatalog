package org.trailcatalog.importers.basemap

import com.google.common.reflect.TypeToken
import org.trailcatalog.importers.pbf.Way
import org.trailcatalog.importers.pipeline.PMapTransformer
import org.trailcatalog.importers.pipeline.collections.Emitter2
import org.trailcatalog.importers.pipeline.collections.PEntry

class InnerJoinWays: PMapTransformer<PEntry<Long, Pair<List<Way>, List<Long>>>, Long, Way>(
    "InnerJoinWays",
    TypeToken.of(Long::class.java),
    TypeToken.of(Way::class.java)) {
  override fun act(
      input: PEntry<Long, Pair<List<Way>, List<Long>>>,
      emitter: Emitter2<Long, Way>) {
    for (value in input.values) {
      if (value.first.isNotEmpty() && value.second.isNotEmpty()) {
        emitter.emit(input.key, value.first[0])
      }
    }
  }
}
