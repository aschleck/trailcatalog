package org.trailcatalog.importers.pipeline

import org.trailcatalog.importers.pipeline.collections.PCollection
import java.util.concurrent.atomic.AtomicInteger

abstract class PSource<T : Any> : PStage<Void?, PCollection<T>>() {

  abstract fun read(): Sequence<T>

  final override fun act(input: Void?, handles: AtomicInteger): () -> PCollection<T> {
    return {
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