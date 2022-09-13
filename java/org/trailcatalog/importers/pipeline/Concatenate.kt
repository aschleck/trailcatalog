package org.trailcatalog.importers.pipeline

import com.google.common.reflect.TypeToken
import org.trailcatalog.importers.pipeline.collections.DisposableSupplier
import org.trailcatalog.importers.pipeline.collections.PCollection
import org.trailcatalog.importers.pipeline.collections.PList
import org.trailcatalog.importers.pipeline.collections.createPList
import java.util.concurrent.atomic.AtomicInteger

class Concatenate<T : Any>(private val type: TypeToken<T>)
  : PStage<List<PCollection<T>>, PCollection<T>>() {

  override fun act(
      input: List<PCollection<T>>,
      dependants: Int): DisposableSupplier<PCollection<T>> {
    return if (dependants > 1) {
      createPList(
          type,
          input.sumOf { it.estimatedByteSize() }) { emitter ->
        for (source in input) {
          while (source.hasNext()) {
            emitter.emit(source.next())
          }
          source.close()
        }
      }
    } else {
      val first = input.indices.firstOrNull { i -> input[i].hasNext() } ?: input.size
      val openCount = AtomicInteger(0)
      DisposableSupplier({ }) {
        if (openCount.incrementAndGet() != 1) {
          throw RuntimeException("Concatenate oneshot can only be used once")
        }

        println("Concatenating oneshot to ${type}")
        object : PList<T> {
          var i = first

          override fun estimatedByteSize(): Long {
            return input.sumOf { it.estimatedByteSize() }
          }

          override fun close() {
            input.forEach { it.close() }
          }

          override fun hasNext(): Boolean {
            return i < input.size
          }

          override fun next(): T {
            val result = input[i].next()
            while (i < input.size && !input[i].hasNext()) {
              i += 1
            }
            return result
          }
        }
      }
    }
  }
}
