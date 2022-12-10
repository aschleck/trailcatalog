package org.trailcatalog.importers.pipeline

import com.google.common.reflect.TypeToken
import org.trailcatalog.importers.pipeline.collections.Emitter2
import org.trailcatalog.importers.pipeline.collections.PEntry

class InvertMap<K : Comparable<K>, V : Comparable<V>>(
    context: String, key: TypeToken<K>, value: TypeToken<V>) :
    PMapTransformer<PEntry<K, V>, V, K>(context, value, key) {

  override fun act(input: PEntry<K, V>, emitter: Emitter2<V, K>) {
    for (value in input.values) {
      emitter.emit(value, input.key)
    }
  }

  override fun estimateRatio(): Double {
    return 1.0
  }
}
