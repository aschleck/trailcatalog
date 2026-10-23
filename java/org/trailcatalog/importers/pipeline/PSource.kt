package org.trailcatalog.importers.pipeline

import com.google.common.reflect.TypeToken
import org.trailcatalog.importers.pipeline.collections.DisposableSupplier
import org.trailcatalog.importers.pipeline.collections.PCollection
import org.trailcatalog.importers.pipeline.collections.createPList

abstract class PSource<T : Any>(private val type: TypeToken<out T>)
  : PStage<Void?, PCollection<T>>() {

  abstract fun read(): Sequence<T>

  final override fun act(input: Void?, dependants: Int): DisposableSupplier<PCollection<T>> {
    // Each read is a whole pass over the input, so we read once and write it out rather than read
    // again for every stage reading this one.
    if (dependants > 1) {
      return createPList(type, estimateCount() * estimateElementBytes()) { emitter ->
        read().forEach(emitter::emit)
      }
    }

    return DisposableSupplier({}) {
      val iterator = read().iterator()

      object : PCollection<T> {
        override fun estimatedByteSize(): Long {
          return this@PSource.estimateCount() * this@PSource.estimateElementBytes()
        }

        override fun close() {}

        override fun hasNext() = iterator.hasNext()

        override fun next() = iterator.next()
      }
    }
  }
}
