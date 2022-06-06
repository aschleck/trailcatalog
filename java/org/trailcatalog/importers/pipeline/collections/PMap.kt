package org.trailcatalog.importers.pipeline.collections

import com.google.common.reflect.TypeToken

interface PMap<K : Comparable<K>, V> : PCollection<PEntry<K, V>>

data class PEntry<K, V>(val key: K, val values: List<V>)

fun <K : Comparable<K>, V : Any> createPMap(
    context: String,
    keyType: TypeToken<K>,
    valueType: TypeToken<out V>,
    estimatedByteSize: Long,
    fn: (Emitter2<K, V>) -> Unit): () -> PMap<K, V> {
  return createMmapPMap(context, keyType, valueType, fn)
}
