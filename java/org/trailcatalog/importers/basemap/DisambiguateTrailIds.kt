package org.trailcatalog.importers.basemap

import com.google.common.reflect.TypeToken
import org.trailcatalog.importers.pipeline.PMapTransformer
import org.trailcatalog.importers.pipeline.collections.Emitter2
import org.trailcatalog.importers.pipeline.collections.PEntry

class DisambiguateTrailIds :
  PMapTransformer<PEntry<String, Long>, String, Long>(
  "DisambiguateTrailIds", TypeToken.of(String::class.java), TypeToken.of(Long::class.java)) {

  override fun act(input: PEntry<String, Long>, emitter: Emitter2<String, Long>) {
    emitter.emit(input.key, input.values[0])
    for (i in 1 until input.values.size) {
      emitter.emit(input.key + "-${i + 1}", input.values[i])
    }
  }
}
