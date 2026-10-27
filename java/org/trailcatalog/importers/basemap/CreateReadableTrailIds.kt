package org.trailcatalog.importers.basemap

import com.google.common.reflect.TypeToken
import org.trailcatalog.importers.pipeline.PMapTransformer
import org.trailcatalog.importers.pipeline.collections.Emitter2
import org.trailcatalog.importers.pipeline.collections.PEntry

class CreateReadableTrailIds :
    PMapTransformer<PEntry<Long, Pair<List<Trail>, List<Boundary>>>, String, Long>(
    "CreateReadableTrailIds", TypeToken.of(String::class.java), TypeToken.of(Long::class.java)) {

  override fun act(
      input: PEntry<Long, Pair<List<Trail>, List<Boundary>>>,
      emitter: Emitter2<String, Long>) {
    for (value in input.values) {
      if (value.first.isEmpty()) {
        continue
      }

      val trail = value.first[0]
      val parts =
          getRegionPrefix(value.second, trail.type) + getReadableName(trail.names, trail.name)
      emitter.emit(parts.joinToString("/") { toReadableId(it) }, input.key)
    }
  }

  override fun estimateRatio(): Double {
    return 0.1
  }
}
