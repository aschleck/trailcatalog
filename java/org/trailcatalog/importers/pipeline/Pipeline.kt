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
      output.act(null).invoke()
    }
  }

  inline fun <reified T : Any> cat(list: List<BoundStage<*, out PCollection<T>>>):
      BoundStage<List<PCollection<T>>, PCollection<T>> {
    val fn = {
      list.map { it.act(null).invoke() }
    }
    return BoundStage(fn, this, Concatenate(object : TypeToken<T>() {}))
  }

  fun <I, O> join(list: List<BoundStage<*, I>>, stage: PStage<List<I>, O>):
      BoundStage<List<I>, O> {
    val fn = {
      list.map { it.act(null).invoke() }
    }
    return BoundStage(fn, this, stage)
  }

  inline fun <reified K : Comparable<K>, reified V1 : Any, reified V2 : Any> join2(
      context: String,
      first: BoundStage<*, PMap<K, V1>>,
      second: BoundStage<*, PMap<K, V2>>):
      BoundStage<*, PMap<K, Pair<List<V1>, List<V2>>>> {
    val fn = {
      Pair(first.act(null).invoke(), second.act(null).invoke())
    }
    return BoundStage(
        fn,
        this,
        ZipMaps2(
            context,
            object : TypeToken<K>() {},
            object : TypeToken<V1>() {},
            object : TypeToken<V2>() {}))
  }

  inline fun <reified T : Comparable<T>> merge(list: List<BoundStage<*, PSortedList<T>>>):
      BoundStage<List<PSortedList<T>>, PSortedList<T>> {
    val fn = {
      list.map { it.act(null).invoke() }
    }
    return BoundStage(fn, this, MergeSort(object : TypeToken<T>() {}))
  }

  fun <T : Any> read(source: PSource<T>): BoundStage<*, PCollection<T>> {
    val fn = {
      null
    }
    return BoundStage(fn, this, source)
  }
}
