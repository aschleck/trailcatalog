package org.trailcatalog.importers.pipeline

import com.google.common.reflect.TypeToken
import com.google.common.truth.Truth.assertThat
import org.junit.Test
import org.trailcatalog.importers.pipeline.collections.Emitter2
import org.trailcatalog.importers.pipeline.collections.PMap

/**
 * A PMap with one consumer merges its shards on read instead of writing a merged file, so the two
 * paths have to hand a consumer the same entries in the same order. Every case here runs the same
 * pipeline with one sink and with two, which is what picks the path, and compares.
 *
 * Shard count comes from heap pressure, so a test this size gets one shard per worker. Parallelism
 * is what varies the number of cursors the merge juggles.
 */
class StreamingMergeTest {

  private class IdentityMap : PMapTransformer<Int, Int, Int>(
      "IdentityMap", TypeToken.of(Int::class.java), TypeToken.of(Int::class.java)) {
    override fun act(input: Int, emitter: Emitter2<Int, Int>) {
      emitter.emit(input, input)
    }
  }

  // Keys collide across workers, so one key's values arrive from several shards at once.
  private class ModKeyMap(private val buckets: Int) : PMapTransformer<Int, Int, Int>(
      "ModKeyMap", TypeToken.of(Int::class.java), TypeToken.of(Int::class.java)) {
    override fun act(input: Int, emitter: Emitter2<Int, Int>) {
      emitter.emit(input % buckets, input)
    }
  }

  // Repeats a key within a single shard, which is the case that makes the merge recheck a cursor
  // it just advanced and put back.
  private class RepeatKeyMap(private val times: Int) : PMapTransformer<Int, Int, Int>(
      "RepeatKeyMap", TypeToken.of(Int::class.java), TypeToken.of(Int::class.java)) {
    override fun act(input: Int, emitter: Emitter2<Int, Int>) {
      for (i in 0 until times) {
        emitter.emit(input, input * 100 + i)
      }
    }
  }

  @Test
  fun identityMatchesMaterialized() {
    assertBothPathsAgree(20_000, 8) { IdentityMap() }
  }

  @Test
  fun keysCollidingAcrossShardsMatchMaterialized() {
    assertBothPathsAgree(20_000, 8) { ModKeyMap(buckets = 10) }
  }

  @Test
  fun repeatedKeyWithinAShardMatchesMaterialized() {
    assertBothPathsAgree(5_000, 8) { RepeatKeyMap(times = 4) }
  }

  @Test
  fun oneWorkerMatchesMaterialized() {
    assertBothPathsAgree(1_000, 1) { IdentityMap() }
  }

  @Test
  fun singleItemMatchesMaterialized() {
    assertBothPathsAgree(1, 4) { IdentityMap() }
  }

  @Test
  fun emptyInputMatchesMaterialized() {
    assertBothPathsAgree(0, 4) { IdentityMap() }
  }

  @Test
  fun streamedEntriesComeOutSortedAndComplete() {
    val entries = collect(20_000, 8, sinks = 1) { ModKeyMap(buckets = 10) }

    assertThat(entries.map { it.key }).isInOrder()
    assertThat(entries.map { it.key }).containsNoDuplicates()
    assertThat(entries).hasSize(10)
    assertThat(entries.sumOf { it.values.size }).isEqualTo(20_000)
  }

  @Test
  fun bothOfTwoConsumersSeeEverything() {
    val out = ArrayList<Entry>()
    val second = ArrayList<Entry>()
    val pipeline = Pipeline(parallelism = 8)
    val stage = pipeline.read(SequenceSource((0 until 5_000).asSequence())).then(IdentityMap())
    stage.write(CollectingSink(out))
    stage.write(CollectingSink(second))
    pipeline.execute()

    assertThat(out).hasSize(5_000)
    assertThat(second).isEqualTo(out)
  }

  private fun assertBothPathsAgree(
      count: Int, parallelism: Int, stage: () -> PMapTransformer<Int, Int, Int>) {
    // Two sinks means two cursors, which a streaming merge cannot serve, so it materializes.
    val materialized = collect(count, parallelism, sinks = 2, stage = stage)
    val streamed = collect(count, parallelism, sinks = 1, stage = stage)

    assertThat(streamed).isEqualTo(materialized)
    assertThat(streamed.sumOf { it.values.size }).isEqualTo(count * emitsPerItem(stage()))
  }

  private fun emitsPerItem(stage: PMapTransformer<Int, Int, Int>): Int {
    var emits = 0
    stage.act(0, object : Emitter2<Int, Int> {
      override fun emit(a: Int, b: Int) {
        emits += 1
      }
    })
    return emits
  }

  private fun collect(
      count: Int,
      parallelism: Int,
      sinks: Int,
      stage: () -> PMapTransformer<Int, Int, Int>): List<Entry> {
    val out = ArrayList<Entry>()
    val pipeline = Pipeline(parallelism = parallelism)
    val bound = pipeline.read(SequenceSource((0 until count).asSequence())).then(stage.invoke())
    bound.write(CollectingSink(out))
    for (i in 1 until sinks) {
      bound.write(CollectingSink(ArrayList()))
    }
    pipeline.execute()
    return out
  }

  private data class Entry(val key: Int, val values: List<Int>)

  private class CollectingSink(val out: MutableList<Entry>) : PSink<PMap<Int, Int>>() {
    override fun write(input: PMap<Int, Int>) {
      while (input.hasNext()) {
        val entry = input.next()
        out.add(Entry(entry.key, entry.values.sorted()))
      }
      input.close()
    }
  }
}
