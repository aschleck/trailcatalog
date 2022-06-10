package org.trailcatalog.importers.pipeline

import com.google.common.reflect.TypeToken
import org.trailcatalog.importers.pipeline.collections.PCollection
import org.trailcatalog.importers.pipeline.collections.createPList
import java.util.concurrent.atomic.AtomicInteger

class Concatenate<T : Any>(private val type: TypeToken<T>)
  : PStage<List<PCollection<T>>, PCollection<T>>() {

  override fun act(input: List<PCollection<T>>, handles: AtomicInteger): () -> PCollection<T> {
    return createPList(
        type,
        input.sumOf { it.estimatedByteSize() },
        handles) { emitter ->
      for (source in input) {
        while (source.hasNext()) {
          emitter.emit(source.next())
        }
        source.close()
      }
    }
  }
}