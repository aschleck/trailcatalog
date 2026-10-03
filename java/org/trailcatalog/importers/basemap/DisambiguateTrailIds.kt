package org.trailcatalog.importers.basemap

import com.google.common.reflect.TypeToken
import org.trailcatalog.importers.pipeline.PMapTransformer
import org.trailcatalog.importers.pipeline.collections.Emitter2
import org.trailcatalog.importers.pipeline.collections.PEntry

class DisambiguateTrailIds :
  PMapTransformer<PEntry<String, Long>, String, Long>(
  "DisambiguateTrailIds", TypeToken.of(String::class.java), TypeToken.of(Long::class.java)) {

  override fun act(input: PEntry<String, Long>, emitter: Emitter2<String, Long>) {
    // The values arrive in whichever order the workers emitted them, so sorting is what keeps a
    // trail's readable id from swapping with a namesake's between imports.
    val ids = input.values.sorted()
    emitter.emit(input.key, ids[0])
    for (i in 1 until ids.size) {
      emitter.emit(input.key + "-${i + 1}", ids[i])
    }
  }
}
