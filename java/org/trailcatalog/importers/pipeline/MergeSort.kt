package org.trailcatalog.importers.pipeline

import com.google.common.reflect.TypeToken
import org.trailcatalog.importers.pipeline.collections.DisposableSupplier
import org.trailcatalog.importers.pipeline.collections.Emitter
import org.trailcatalog.importers.pipeline.collections.PSortedList
import org.trailcatalog.importers.pipeline.collections.createPSortedList
import java.util.PriorityQueue

class MergeSort<V : Comparable<V>>(private val type: TypeToken<V>)
  : PStage<List<PSortedList<V>>, PSortedList<V>>() {

  override fun estimateRatio(): Double {
    return 1.0
  }

  override fun act(
      input: List<PSortedList<V>>,
      dependants: Int): DisposableSupplier<PSortedList<V>> {
    val estimate = (estimateRatio() * input.sumOf { it.estimatedByteSize() }).toLong()
    return createPSortedList(type, estimate) { emitter ->
      merge(input, emitter)
    }
  }

  private fun merge(input: List<PSortedList<V>>, emitter: Emitter<V>) {
    val heap = PriorityQueue<MergeKey<V>>()
    for (source in input) {
      if (source.hasNext()) {
        heap.add(MergeKey(source.next(), source))
      }
    }

    var last: V? = null
    while (heap.isNotEmpty()) {
      val min = heap.poll()
      if (last == null || last.compareTo(min.value) != 0) {
        emitter.emit(min.value)
        last = min.value
      }

      if (min.source.hasNext()) {
        heap.add(MergeKey(min.source.next(), min.source))
      } else {
        min.source.close()
      }
    }
  }
}

private data class MergeKey<V : Comparable<V>>(val value: V, val source: PSortedList<V>)
  : Comparable<MergeKey<V>> {

  override fun compareTo(other: MergeKey<V>): Int {
    return value.compareTo(other.value)
  }
}
