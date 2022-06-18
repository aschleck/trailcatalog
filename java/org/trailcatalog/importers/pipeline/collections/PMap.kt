package org.trailcatalog.importers.pipeline.collections

import com.google.common.reflect.TypeToken
import java.util.concurrent.atomic.AtomicInteger

interface PMap<K : Comparable<K>, V> : PCollection<PEntry<K, V>>

data class PEntry<K, V>(val key: K, val values: List<V>)

fun <K : Comparable<K>, V : Any> createPMap(
    context: String,
    keyType: TypeToken<K>,
    valueType: TypeToken<out V>,
    estimatedByteSize: Long,
    handles: AtomicInteger,
    fn: (Emitter2<K, V>) -> Unit): () -> PMap<K, V> {
  return createMmapPMap(context, keyType, valueType, estimatedByteSize, handles, fn)
}
