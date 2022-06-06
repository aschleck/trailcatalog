package org.trailcatalog.importers.pipeline

import com.google.common.reflect.TypeToken
import org.trailcatalog.importers.pipeline.collections.Emitter2
import org.trailcatalog.importers.pipeline.collections.PCollection
import org.trailcatalog.importers.pipeline.collections.PMap
import org.trailcatalog.importers.pipeline.collections.createPMap

abstract class PMapTransformer<I, K : Comparable<K>, V : Any>(
    private val keyType: TypeToken<K>,
    private val valueType: TypeToken<V>,
) : PStage<PCollection<I>, PMap<K, V>>() {

  abstract fun act(input: I, emitter: Emitter2<K, V>)

  override fun act(input: PCollection<I>): () -> PMap<K, V> {
    val estimate =
        (estimateRatio() * input.estimatedByteSize()).toLong()
            + estimateCount() * estimateElementBytes()
    return createPMap(keyType, valueType, estimate) { emitter ->
      while (input.hasNext()) {
        act(input.next(), emitter)
      }
    }
  }
}
