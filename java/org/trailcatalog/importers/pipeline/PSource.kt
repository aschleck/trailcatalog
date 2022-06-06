package org.trailcatalog.importers.pipeline

import org.trailcatalog.importers.pipeline.collections.PCollection
import kotlin.reflect.KClass

abstract class PSource<T : Any>() : PStage<Void?, PCollection<T>>() {

  abstract fun read(): Sequence<T>

  final override fun act(input: Void?): () -> PCollection<T> {
    return {
      val iterator = read().iterator()

      object : PCollection<T> {
        override fun estimatedByteSize(): Long {
          return this@PSource.estimateCount() * this@PSource.estimateElementBytes()
        }

        override fun hasNext() = iterator.hasNext()

        override fun next() = iterator.next()
      }
    }
  }
}