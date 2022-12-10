package org.trailcatalog.importers.pipeline

import com.google.common.reflect.TypeToken
import org.trailcatalog.importers.pipeline.collections.Emitter2
import org.trailcatalog.importers.pipeline.collections.PEntry

class UniqueValues<K : Comparable<K>, V : Any>(
    context: String, key: TypeToken<K>, value: TypeToken<V>) :
    PMapTransformer<PEntry<K, V>, K, V>(context, key, value) {

  override fun act(input: PEntry<K, V>, emitter: Emitter2<K, V>) {
    val seen = HashSet<V>()
    for (value in input.values) {
      if (seen.contains(value)) {
        continue
      }
      seen.add(value)
      emitter.emit(input.key, value)
    }
  }

  override fun estimateRatio(): Double {
    return 1.0
  }
}
