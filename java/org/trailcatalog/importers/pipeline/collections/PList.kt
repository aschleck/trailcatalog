package org.trailcatalog.importers.pipeline.collections

import com.google.common.reflect.TypeToken

interface PList<T> : PCollection<T>

fun <T : Any> createPList(
    type: TypeToken<out T>,
    estimatedByteSize: Long,
    fn: (Emitter<T>) -> Unit): DisposableSupplier<PList<T>> {
  return createMmapPList(type, fn)
}

/**
 * Parallel variant: drives [input] on the caller thread and dispatches batches to [workers]
 * worker threads. Each worker runs [perItem] and writes into its own output file.
 *
 * Passing `workers <= 1` falls back to the single-threaded path.
 */
fun <I, T : Any> createPList(
    context: String,
    type: TypeToken<out T>,
    estimatedByteSize: Long,
    input: PCollection<I>,
    workers: Int,
    perItem: (I, Emitter<T>) -> Unit): DisposableSupplier<PList<T>> {
  return createMmapPList(context, type, input, workers, perItem)
}
