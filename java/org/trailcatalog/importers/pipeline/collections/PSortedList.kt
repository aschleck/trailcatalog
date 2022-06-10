package org.trailcatalog.importers.pipeline.collections

import com.google.common.reflect.TypeToken
import java.util.concurrent.atomic.AtomicInteger

interface PSortedList<T> : PList<T> {
  fun find(needle: (v: T) -> Int): T?
}

fun <T : Comparable<T>> createPSortedList(
    type: TypeToken<T>, estimatedByteSize: Long, handles: AtomicInteger, fn: (Emitter<T>) -> Unit):
    () -> PSortedList<T> {
  return createMmapPSortedList(type, handles, fn)
}
