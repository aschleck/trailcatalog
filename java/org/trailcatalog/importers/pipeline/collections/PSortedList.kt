package org.trailcatalog.importers.pipeline.collections

import com.google.common.reflect.TypeToken

interface PSortedList<T> : PList<T> {
  fun find(needle: (v: T) -> Int): T?
}

fun <T : Comparable<T>> createPSortedList(
    type: TypeToken<T>, estimatedByteSize: Long, fn: (Emitter<T>) -> Unit):
    DisposableSupplier<PSortedList<T>> {
  return createMmapPSortedList(type, fn)
}
