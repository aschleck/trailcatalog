package org.trailcatalog.importers.pipeline

import org.trailcatalog.importers.pipeline.collections.DisposableSupplier
import org.trailcatalog.importers.pipeline.collections.PCollection

abstract class PSource<T : Any> : PStage<Void?, PCollection<T>>() {

  abstract fun read(): Sequence<T>

  final override fun act(input: Void?): DisposableSupplier<PCollection<T>> {
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