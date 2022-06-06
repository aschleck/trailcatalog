package org.trailcatalog.importers.pipeline.collections

import com.google.common.reflect.TypeToken

interface PList<T> : PCollection<T>

fun <T : Any> createPList(
    type: TypeToken<out T>, estimatedByteSize: Long, fn: (Emitter<T>) -> Unit): () -> PList<T> {
  return createMmapPList(type, fn)
}
