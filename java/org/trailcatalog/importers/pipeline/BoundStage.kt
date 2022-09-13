package org.trailcatalog.importers.pipeline

import com.google.common.reflect.TypeToken
import org.trailcatalog.importers.pipeline.collections.DisposableSupplier
import org.trailcatalog.importers.pipeline.collections.Emitter2
import org.trailcatalog.importers.pipeline.collections.PCollection
import org.trailcatalog.importers.pipeline.collections.PMap
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference

abstract class BoundStage<I, O>(
    val pipeline: Pipeline,
    val stage: PStage<in I, O>,
) {

  private val handles = AtomicInteger(0)
  private val result = AtomicReference<DisposableSupplier<O>>()
  private var traced = false

  fun <R> then(next: PStage<in O, R>): BoundStage<in O, R> {
    return object : BoundStage<O, R>(pipeline, next) {
      override fun getInput(): O {
        return this@BoundStage.invoke()
      }

      override fun traceInputs() {
        this@BoundStage.trace()
      }
    }
  }

  fun write(next: PStage<in O, Void?>) {
    pipeline.addOutput(this.then(next))
  }

  fun invoke(): O {
    val existing = result.get()
    val computed = if (existing == null) {
      result.set(this.stage.act(getInput(), this.handles.get()))
      result.get()
    } else {
      existing
    }

    // This is a little strange because we get the handle and then close it, which means we may have
    // a handle to a deleted file.
    val handle = computed.invoke()
    if (this.handles.decrementAndGet() == 0) {
      computed.close()
    }
    return handle
  }

  protected abstract fun getInput(): I

  fun trace() {
    this.handles.incrementAndGet()

    if (!this.traced) {
      this.traceInputs()
      this.traced = true
    }
  }

  protected open fun traceInputs() {}
}

inline fun <reified K : Comparable<K>, reified V : Any> BoundStage<*, out PCollection<V>>.groupBy(
    context: String,
    crossinline keyFn: (V) -> K): BoundStage<PCollection<V>, PMap<K, V>> {
  val act = {
    this.invoke()
  }
  val trace = {
    this.trace()
  }
  return object : BoundStage<PCollection<V>, PMap<K, V>>(
      pipeline,
      object : PMapTransformer<V, K, V>(
          context, object : TypeToken<K>() {}, object : TypeToken<V>() {}) {

        override fun estimateRatio(): Double {
          return 1.25
        }

        override fun act(input: V, emitter: Emitter2<K, V>) {
          emitter.emit(keyFn.invoke(input), input)
        }
      }) {
    override fun getInput(): PCollection<V> {
      return act.invoke()
    }

    override fun traceInputs() {
      trace.invoke()
    }
  }
}