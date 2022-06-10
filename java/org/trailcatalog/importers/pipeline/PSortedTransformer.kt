package org.trailcatalog.importers.pipeline

import com.google.common.reflect.TypeToken
import org.trailcatalog.importers.pipeline.collections.Emitter
import org.trailcatalog.importers.pipeline.collections.PCollection
import org.trailcatalog.importers.pipeline.collections.PSortedList
import org.trailcatalog.importers.pipeline.collections.createPSortedList
import java.util.concurrent.atomic.AtomicInteger

abstract class PSortedTransformer<I, O : Comparable<O>>(
    private val type: TypeToken<O>,
) : PStage<PCollection<I>, PSortedList<O>>() {

  abstract fun act(input: I, emitter: Emitter<O>)

  override fun act(input: PCollection<I>, handles: AtomicInteger): () -> PSortedList<O> {
    val estimate =
        (estimateRatio() * input.estimatedByteSize()).toLong()
            + estimateCount() * estimateElementBytes()
    return createPSortedList(type, estimate, handles) { emitter ->
      while (input.hasNext()) {
        act(input.next(), emitter)
      }
      input.close()
    }
  }
}
