package org.trailcatalog.importers.pipeline

import com.google.common.reflect.TypeToken
import org.trailcatalog.importers.pipeline.collections.DisposableSupplier
import org.trailcatalog.importers.pipeline.collections.PCollection
import org.trailcatalog.importers.pipeline.collections.PList

/**
 * Reads its inputs back to back without copying them. Each invocation takes a new reader from
 * every input, so Pipeline#cat gives the inputs one handle per dependant.
 */
class Concatenate<T : Any>(private val type: TypeToken<T>)
  : PStage<List<() -> PCollection<T>>, PCollection<T>>() {

  override fun act(
      input: List<() -> PCollection<T>>,
      dependants: Int): DisposableSupplier<PCollection<T>> {
    return DisposableSupplier({ }) {
      println("Concatenating to ${type}")
      ConcatenatedPList(input.map { it.invoke() })
    }
  }
}

private class ConcatenatedPList<T>(private val lists: List<PCollection<T>>) : PList<T> {

  private var i = 0

  override fun estimatedByteSize(): Long {
    return lists.sumOf { it.estimatedByteSize() }
  }

  override fun close() {
    lists.forEach { it.close() }
  }

  override fun hasNext(): Boolean {
    while (i < lists.size && !lists[i].hasNext()) {
      i += 1
    }
    return i < lists.size
  }

  override fun next(): T {
    if (!hasNext()) {
      throw NoSuchElementException()
    }
    return lists[i].next()
  }
}
