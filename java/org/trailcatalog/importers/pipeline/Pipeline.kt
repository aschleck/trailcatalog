package org.trailcatalog.importers.pipeline

import com.google.common.reflect.TypeToken
import org.trailcatalog.importers.pipeline.collections.PCollection
import org.trailcatalog.importers.pipeline.collections.PMap
import org.trailcatalog.importers.pipeline.collections.PSortedList

class Pipeline {

  private val outputs = ArrayList<BoundStage<*, *>>()

  fun addOutput(stage: BoundStage<*, *>) {
    outputs.add(stage)
  }

  fun execute() {
    for (output in outputs) {
      output.trace()
    }

    for (output in outputs) {
      output.invoke()
    }
  }

  inline fun <reified T : Any> cat(list: List<BoundStage<*, out PCollection<T>>>):
      BoundStage<*, out PCollection<T>> {
    if (list.size == 1) {
      return list[0]
    }

    return object : BoundStage<List<PCollection<T>>, PCollection<T>>(this, Concatenate(object : TypeToken<T>() {})) {
      override fun getInput(): List<PCollection<T>> {
        return list.map { it.invoke() }
      }

      override fun traceInputs() {
        list.forEach { it.trace() }
      }
    }
  }

  fun <I, O> join(list: List<BoundStage<*, I>>, stage: PStage<List<I>, O>):
      BoundStage<List<I>, O> {
    return object : BoundStage<List<I>, O>(this, stage) {
      override fun getInput(): List<I> {
        return list.map { it.invoke() }
      }

      override fun traceInputs() {
        list.forEach { it.trace() }
      }
    }
  }

  inline fun <reified K : Comparable<K>, reified V1 : Any, reified V2 : Any> join2(
      context: String,
      first: BoundStage<*, PMap<K, V1>>,
      second: BoundStage<*, PMap<K, V2>>):
      BoundStage<Pair<PMap<K, V1>, PMap<K, V2>>, PMap<K, Pair<List<V1>, List<V2>>>> {
    return object : BoundStage<Pair<PMap<K, V1>, PMap<K, V2>>, PMap<K, Pair<List<V1>, List<V2>>>>(
        this,
        ZipMaps2(
            context,
            object : TypeToken<K>() {},
            object : TypeToken<V1>() {},
            object : TypeToken<V2>() {})) {

      override fun getInput(): Pair<PMap<K, V1>, PMap<K, V2>> {
        return Pair(first.invoke(), second.invoke())
      }

      override fun traceInputs() {
        first.trace()
        second.trace()
      }
    }
  }

  inline fun <reified T : Comparable<T>> merge(list: List<BoundStage<*, PSortedList<T>>>):
      BoundStage<List<PSortedList<T>>, PSortedList<T>> {
    return object : BoundStage<List<PSortedList<T>>, PSortedList<T>>(
        this, MergeSort(object : TypeToken<T>() {})) {

      override fun getInput(): List<PSortedList<T>> {
        return list.map { it.invoke() }
      }

      override fun traceInputs() {
        list.forEach { it.trace() }
      }
    }
  }

  fun <T : Any> read(source: PSource<T>): BoundStage<Void?, PCollection<T>> {
    return object : BoundStage<Void?, PCollection<T>>(this, source) {
      override fun getInput(): Void? {
        return null
      }
    }
  }
}
