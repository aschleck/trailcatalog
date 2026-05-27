package org.trailcatalog.importers.pipeline.collections

import com.google.common.reflect.TypeToken

interface PMap<K : Comparable<K>, V> : PCollection<PEntry<K, V>>

data class PEntry<K, V>(val key: K, val values: List<V>)

fun <K : Comparable<K>, V : Any> createPMap(
    context: String,
    keyType: TypeToken<K>,
    valueType: TypeToken<out V>,
    estimatedByteSize: Long,
    fn: (Emitter2<K, V>) -> Unit): DisposableSupplier<PMap<K, V>> {
  return createMmapPMap(context, keyType, valueType, estimatedByteSize, fn)
}

/**
 * Parallel variant: drives [input] on the caller thread and dispatches batches to [workers]
 * worker threads. Each worker runs [perItem] and writes into its own pre-sort shard file. The
 * K-way merge picks up shards from all worker files transparently.
 *
 * Passing `workers <= 1` falls back to the single-threaded path.
 */
fun <I, K : Comparable<K>, V : Any> createPMap(
    context: String,
    keyType: TypeToken<K>,
    valueType: TypeToken<out V>,
    estimatedByteSize: Long,
    input: PCollection<I>,
    workers: Int,
    perItem: (I, Emitter2<K, V>) -> Unit): DisposableSupplier<PMap<K, V>> {
  return createMmapPMap(context, keyType, valueType, estimatedByteSize, input, workers, perItem)
}
