package org.trailcatalog.importers.pipeline.collections

import com.google.common.reflect.TypeToken

interface PList<T> : PCollection<T>

fun <T : Any> createPList(
    type: TypeToken<out T>, estimatedByteSize: Long, fn: (Emitter<T>) -> Unit): () -> PList<T> {
  return when (storeInMemory(estimatedByteSize)) {
    true -> createInMemoryPList(estimatedByteSize, fn)
    else -> createMmapPList(type, fn)
  }
}
