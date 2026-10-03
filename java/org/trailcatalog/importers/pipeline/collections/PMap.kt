package org.trailcatalog.importers.pipeline.collections

import com.google.common.reflect.TypeToken

interface PMap<K : Comparable<K>, V> : PCollection<PEntry<K, V>>

data class PEntry<K, V>(val key: K, val values: List<V>)

/** A PMap that can be cut into key ranges. */
interface SplittablePMap<K : Comparable<K>, V> : PMap<K, V>, Partitionable<PEntry<K, V>> {

  /** Keys from throughout the map, in no particular order, for choosing where to split. */
  fun sampleKeys(): List<K>

  /**
   * Cuts the map at [splits], which must be sorted, so that part i holds the keys from
   * splits[i - 1] up to but not including splits[i]. Only valid before anything has been read.
   * Closing the parts does nothing; closing this closes them.
   */
  fun split(splits: List<K>): List<PMap<K, V>>

  override fun partition(parts: Int): List<PCollection<PEntry<K, V>>> {
    return split(chooseSplits(sampleKeys(), parts))
  }
}

/** Returns up to [parts] - 1 distinct keys that cut [samples] into equal runs. */
fun <K : Comparable<K>> chooseSplits(samples: List<K>, parts: Int): List<K> {
  if (parts <= 1 || samples.isEmpty()) {
    return emptyList()
  }

  val sorted = samples.sorted()
  val splits = ArrayList<K>()
  for (i in 1 until parts) {
    val key = sorted[(i.toLong() * sorted.size / parts).toInt()]
    if (splits.isEmpty() || splits.last() < key) {
      splits.add(key)
    }
  }
  return splits
}

fun <K : Comparable<K>, V : Any> createPMap(
    context: String,
    keyType: TypeToken<K>,
    valueType: TypeToken<out V>,
    estimatedByteSize: Long,
    fn: (Emitter2<K, V>) -> Unit): DisposableSupplier<PMap<K, V>> {
  return createMmapPMap(context, keyType, valueType, estimatedByteSize, fn)
}

/**
 * Parallel variant: [workers] threads each run [perItem] and write their own sorted runs, reading
 * partitionable input directly or taking batches from the caller thread.
 *
 * Passing `workers <= 1` falls back to the single-threaded path. Passing `dependants` of 1 lets the
 * merge run on read rather than through a merged file, so pass the count act() was handed.
 */
fun <I, K : Comparable<K>, V : Any> createPMap(
    context: String,
    keyType: TypeToken<K>,
    valueType: TypeToken<out V>,
    estimatedByteSize: Long,
    input: PCollection<I>,
    workers: Int,
    dependants: Int,
    perItem: (I, Emitter2<K, V>) -> Unit): DisposableSupplier<PMap<K, V>> {
  return createMmapPMap(
      context, keyType, valueType, estimatedByteSize, input, workers, dependants, perItem)
}
