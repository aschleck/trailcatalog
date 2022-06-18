package org.trailcatalog.importers.pipeline

import com.google.common.reflect.TypeToken
import org.trailcatalog.importers.pipeline.collections.Emitter2
import org.trailcatalog.importers.pipeline.collections.PCollection
import org.trailcatalog.importers.pipeline.collections.PMap
import java.util.concurrent.atomic.AtomicInteger

class BoundStage<I, O>(
    val input: () -> I,
    val pipeline: Pipeline,
    val stage: PStage<I, O>,
) : PStage<Void?, O>() {

  private var handles = AtomicInteger(0)
  private var memoized: (() -> O)? = null

  fun <T> then(next: PStage<in O, T>): BoundStage<in O, T> {
    return BoundStage(this.act(null, AtomicInteger(-1)), pipeline, next)
  }

  fun write(next: PStage<in O, Void?>) {
    val stage = BoundStage(this.act(null, AtomicInteger(-1)), pipeline, next)
    pipeline.addOutput(stage)
  }

  override fun act(input: Void?, handles: AtomicInteger): () -> O {
    this.handles.incrementAndGet()
    return {
      var result = memoized
      if (result == null) {
        result = stage.act(this.input.invoke(), this.handles)
        memoized = result
      }
      result.invoke()
    }
  }
}

inline fun <reified K : Comparable<K>, reified V : Any> BoundStage<*, out PCollection<V>>.groupBy(
    context: String,
    crossinline keyFn: (V) -> K): BoundStage<PCollection<V>, PMap<K, V>> {
  return BoundStage(
      this.act(null, AtomicInteger(-1)),
      pipeline,
      object : PMapTransformer<V, K, V>(
          context, object : TypeToken<K>() {}, object : TypeToken<V>() {}) {

    override fun estimateRatio(): Double {
      return 1.25
    }

    override fun act(input: V, emitter: Emitter2<K, V>) {
      emitter.emit(keyFn.invoke(input), input)
    }
  })
}