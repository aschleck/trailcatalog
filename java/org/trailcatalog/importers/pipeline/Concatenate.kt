package org.trailcatalog.importers.pipeline

import com.google.common.reflect.TypeToken
import org.trailcatalog.importers.pipeline.collections.PCollection
import org.trailcatalog.importers.pipeline.collections.createPList

class Concatenate<T : Any>(private val type: TypeToken<T>)
  : PStage<List<PCollection<T>>, PCollection<T>>() {

  override fun act(input: List<PCollection<T>>): () -> PCollection<T> {
    return createPList(
        type,
        input.sumOf { it.estimatedByteSize() }) { emitter ->
      for (source in input) {
        while (source.hasNext()) {
          emitter.emit(source.next())
        }
      }
    }
  }
}