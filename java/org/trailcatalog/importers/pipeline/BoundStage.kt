package org.trailcatalog.importers.pipeline

import com.google.common.reflect.TypeToken
import org.trailcatalog.importers.pipeline.collections.Emitter2
import org.trailcatalog.importers.pipeline.collections.PCollection
import org.trailcatalog.importers.pipeline.collections.PMap

class BoundStage<I, O>(
    val input: () -> I,
    val pipeline: Pipeline,
    val stage: PStage<I, O>,
) : PStage<Void?, O>() {

  fun <T> then(next: PStage<in O, T>): BoundStage<in O, T> {
    return BoundStage(this.act(null), pipeline, next)
  }

  fun write(next: PStage<in O, Void?>) {
    val stage = BoundStage(this.act(null), pipeline, next)
    pipeline.addOutput(stage)
  }

  override fun act(input: Void?): () -> O {
    return {
      stage.act(this.input.invoke()).invoke()
    }
  }
}

inline fun <reified K : Comparable<K>, reified V : Any> BoundStage<*, out PCollection<V>>.groupBy(
    context: String,
    crossinline keyFn: (V) -> K): BoundStage<PCollection<V>, PMap<K, V>> {
  return BoundStage(
      this.act(null),
      pipeline,
      object : PMapTransformer<V, K, V>(
          context, object : TypeToken<K>() {}, object : TypeToken<V>() {}) {

    override fun estimateRatio(): Double {
      return 2.0
    }

    override fun act(input: V, emitter: Emitter2<K, V>) {
      emitter.emit(keyFn.invoke(input), input)
    }
  })
}