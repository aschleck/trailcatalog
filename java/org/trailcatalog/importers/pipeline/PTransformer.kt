package org.trailcatalog.importers.pipeline

import com.google.common.reflect.TypeToken
import org.trailcatalog.importers.pipeline.collections.DisposableSupplier
import org.trailcatalog.importers.pipeline.collections.Emitter
import org.trailcatalog.importers.pipeline.collections.PCollection
import org.trailcatalog.importers.pipeline.collections.PList
import org.trailcatalog.importers.pipeline.collections.createPList

abstract class PTransformer<I, O : Any>(private val type: TypeToken<out O>)
  : PStage<PCollection<I>, PList<O>>() {

  abstract fun act(input: I, emitter: Emitter<O>)

  override fun act(input: PCollection<I>): DisposableSupplier<PList<O>> {
    val estimate =
        (estimateRatio() * input.estimatedByteSize()).toLong()
            + estimateCount() * estimateElementBytes()
    return createPList(type, estimate) { emitter ->
      while (input.hasNext()) {
        act(input.next(), emitter)
      }
      input.close()
    }
  }
}
