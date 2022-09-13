package org.trailcatalog.importers.pipeline

import com.google.common.reflect.TypeToken
import org.trailcatalog.importers.pipeline.collections.DisposableSupplier
import org.trailcatalog.importers.pipeline.collections.Emitter
import org.trailcatalog.importers.pipeline.collections.PCollection
import org.trailcatalog.importers.pipeline.collections.PList
import org.trailcatalog.importers.pipeline.collections.createPList
import java.util.concurrent.atomic.AtomicInteger

abstract class PTransformer<I, O : Any>(private val type: TypeToken<out O>)
  : PStage<PCollection<I>, PList<O>>() {

  abstract fun act(input: I, emitter: Emitter<O>)

  override fun act(input: PCollection<I>, dependants: Int): DisposableSupplier<PList<O>> {
    val estimate =
        (estimateRatio() * input.estimatedByteSize()).toLong()
            + estimateCount() * estimateElementBytes()
    if (dependants > 1) {
      return createPList(type, estimate) { emitter ->
        while (input.hasNext()) {
          act(input.next(), emitter)
        }
        input.close()
      }
    } else {
      val openCount = AtomicInteger(0)
      return DisposableSupplier({ }) {
        if (openCount.incrementAndGet() != 1) {
          throw RuntimeException("Concatenate oneshot can only be used once")
        }
        println("Transforming oneshot to ${type}")
        object : PList<O> {

          val queue = ArrayDeque<O>()
          val emitter = object : Emitter<O> {
            override fun emit(v: O) {
              queue.addLast(v)
            }
          }

          override fun estimatedByteSize(): Long {
            return estimate
          }

          override fun close() {
            input.close()
          }

          override fun hasNext(): Boolean {
            while (queue.isEmpty() && input.hasNext()) {
              // How much data can this generate? input.next() has to fit in memory, so whatever we
              // emit in one call to act probably fits too. Still scary but seems fine.
              act(input.next(), emitter)
            }
            return queue.isNotEmpty()
          }

          override fun next(): O {
            return queue.removeFirst()
          }
        }
      }
    }
  }
}
