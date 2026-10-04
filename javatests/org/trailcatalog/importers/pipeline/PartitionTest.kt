package org.trailcatalog.importers.pipeline

import com.google.common.reflect.TypeToken
import com.google.common.truth.Truth.assertThat
import org.junit.Test
import org.trailcatalog.importers.pipeline.collections.Emitter2
import org.trailcatalog.importers.pipeline.collections.PEntry
import org.trailcatalog.importers.pipeline.collections.PMap
import org.trailcatalog.importers.pipeline.collections.Partitionable
import org.trailcatalog.importers.pipeline.collections.SplittablePMap
import org.trailcatalog.importers.pipeline.collections.chooseSplits

// Runs index every 256 KB, so this many records gives each worker's run a few dozen index entries
// and the maps plenty of places to split.
private const val COUNT = 600_000

// Keys repeat, so one key's values come from several runs and from several records in one run,
// which is what a split must not cut through.
private const val BUCKETS = 50_000

/**
 * Splitting a map or partitioning a zip has to hand out every entry exactly once, in key ranges
 * that don't overlap, whichever key type picks the run buffer.
 */
class PartitionTest {

  private class KeyBy<K : Comparable<K>>(
      private val keyType: TypeToken<K>,
      private val key: (Int) -> K,
  ) : PMapTransformer<Int, K, Int>("KeyBy", keyType, TypeToken.of(Int::class.java)) {
    override fun act(input: Int, emitter: Emitter2<K, Int>) {
      emitter.emit(key(input), input)
    }
  }

  @Test
  fun splitsIntKeyedMaps() {
    assertSplitsCleanly(TypeToken.of(Int::class.java)) { it % BUCKETS }
  }

  @Test
  fun splitsLongKeyedMaps() {
    assertSplitsCleanly(TypeToken.of(Long::class.java)) { (it % BUCKETS).toLong() * -7919L }
  }

  @Test
  fun splitsStringKeyedMaps() {
    assertSplitsCleanly(TypeToken.of(String::class.java)) { "k${it % BUCKETS}" }
  }

  @Test
  fun partitionsZipsOfIntKeyedMaps() {
    assertZipPartitionsCleanly(TypeToken.of(Int::class.java)) { it }
  }

  @Test
  fun partitionsZipsOfStringKeyedMaps() {
    assertZipPartitionsCleanly(TypeToken.of(String::class.java)) { "k${it}" }
  }

  // Keys are stored as the difference from the previous one in a block, and these differences wrap
  // past Long.MAX_VALUE.
  @Test
  fun extremeLongKeysRoundTrip() {
    val keys =
        listOf(Long.MIN_VALUE, Long.MIN_VALUE + 1, -5L, 0L, 7L, Long.MAX_VALUE - 1, Long.MAX_VALUE)
    for (sinks in listOf(1, 2)) {
      val out = ArrayList<PEntry<Long, Int>>()
      val pipeline = Pipeline(parallelism = 2)
      val map =
          pipeline.read(SequenceSource((0 until 700).asSequence()))
              .then(KeyBy(TypeToken.of(Long::class.java)) { keys[it % keys.size] })
      repeat(sinks) { i ->
        map.write(object : PSink<PMap<Long, Int>>() {
          override fun write(input: PMap<Long, Int>) {
            input.use {
              while (input.hasNext()) {
                val entry = input.next()
                if (i == 0) out.add(PEntry(entry.key, entry.values.sorted()))
              }
            }
          }
        })
      }
      pipeline.execute()

      assertThat(out)
          .isEqualTo(
              keys.sorted().map { key ->
                PEntry(key, (0 until 700).filter { keys[it % keys.size] == key })
              })
    }
  }

  // Bigger than both the 1 MB scratch buffer a worker starts with and a 2 MB arena.
  @Test
  fun valuesLargerThanTheScratchBufferRoundTrip() {
    val out = HashMap<Int, List<String>>()
    val pipeline = Pipeline(parallelism = 2)
    pipeline.read(SequenceSource((0 until 12).asSequence()))
        .then(
            object : PMapTransformer<Int, Int, String>(
                "Big", TypeToken.of(Int::class.java), TypeToken.of(String::class.java)) {
              override fun act(input: Int, emitter: Emitter2<Int, String>) {
                emitter.emit(input % 4, "${input}".repeat(1_500_000))
              }
            })
        .write(object : PSink<PMap<Int, String>>() {
          override fun write(input: PMap<Int, String>) {
            input.use {
              while (input.hasNext()) {
                val entry = input.next()
                out[entry.key] = entry.values.sorted()
              }
            }
          }
        })
    pipeline.execute()

    assertThat(out)
        .isEqualTo(
            (0 until 12).groupBy({ it % 4 }, { "${it}".repeat(1_500_000) })
                .mapValues { it.value.sorted() })
  }

  @Test
  fun parallelStageOverZipMatchesExpected() {
    val out = ArrayList<String>()
    val pipeline = Pipeline(parallelism = 4)
    val left =
        pipeline.read(SequenceSource((0 until COUNT).asSequence()))
            .then(KeyBy(TypeToken.of(Int::class.java)) { it % BUCKETS })
    val right =
        pipeline.read(SequenceSource((0 until COUNT / 3).asSequence()))
            .then(KeyBy(TypeToken.of(Int::class.java)) { (it * 7) % (2 * BUCKETS) })
    pipeline
        .join2("Zip", left, right)
        .then(
            object : PMapTransformer<PEntry<Int, Pair<List<Int>, List<Int>>>, Int, String>(
                "Describe", TypeToken.of(Int::class.java), TypeToken.of(String::class.java)) {
              override fun act(
                  input: PEntry<Int, Pair<List<Int>, List<Int>>>, emitter: Emitter2<Int, String>) {
                val (lefts, rights) = input.values[0]
                emitter.emit(
                    input.key, "${lefts.size} ${lefts.sum()} ${rights.size} ${rights.sum()}")
              }
            })
        .write(object : PSink<PMap<Int, String>>() {
          override fun write(input: PMap<Int, String>) {
            input.use {
              while (input.hasNext()) {
                val entry = input.next()
                out.add("${entry.key}: ${entry.values.single()}")
              }
            }
          }
        })
    pipeline.execute()

    val lefts = (0 until COUNT).groupBy { it % BUCKETS }
    val rights = (0 until COUNT / 3).groupBy { (it * 7) % (2 * BUCKETS) }
    val expected =
        (lefts.keys + rights.keys).sorted().map {
          val l = lefts[it] ?: emptyList()
          val r = rights[it] ?: emptyList()
          "${it}: ${l.size} ${l.sum()} ${r.size} ${r.sum()}"
        }
    assertThat(out).isEqualTo(expected)
  }

  private fun <K : Comparable<K>> assertSplitsCleanly(keyType: TypeToken<K>, key: (Int) -> K) {
    val expected = (0 until COUNT).groupBy(key).mapValues { it.value.sorted() }

    // One sink merges on read and two materialize, and both kinds of map have to split.
    for (sinks in listOf(1, 2)) {
      val checked = ArrayList<Boolean>()
      val pipeline = Pipeline(parallelism = 4)
      val map =
          pipeline.read(SequenceSource((0 until COUNT).asSequence())).then(KeyBy(keyType, key))
      repeat(sinks) {
        map.write(object : PSink<PMap<K, Int>>() {
          override fun write(input: PMap<K, Int>) {
            input.use {
              check(input is SplittablePMap<K, Int>)
              val splits = chooseSplits(input.sampleKeys(), 16)
              assertThat(splits.size).isGreaterThan(4)

              val parts = input.split(splits)
              assertThat(parts).hasSize(splits.size + 1)
              val seen = HashMap<K, List<Int>>()
              for ((i, part) in parts.withIndex()) {
                var last: K? = null
                while (part.hasNext()) {
                  val entry = part.next()
                  if (i > 0) assertThat(entry.key).isAtLeast(splits[i - 1])
                  if (i < splits.size) assertThat(entry.key).isLessThan(splits[i])
                  if (last != null) assertThat(entry.key).isGreaterThan(last)
                  last = entry.key
                  assertThat(seen.put(entry.key, entry.values.sorted())).isNull()
                }
              }
              assertThat(seen).isEqualTo(expected)
              checked.add(true)
            }
          }
        })
      }
      pipeline.execute()
      assertThat(checked).hasSize(sinks)
    }
  }

  private inline fun <reified K : Comparable<K>> assertZipPartitionsCleanly(
      keyType: TypeToken<K>, crossinline key: (Int) -> K) {
    val seen = HashMap<K, Pair<List<Int>, List<Int>>>()
    var nonEmptyParts = 0
    val pipeline = Pipeline(parallelism = 4)
    val left =
        pipeline.read(SequenceSource((0 until COUNT).asSequence()))
            .then(KeyBy(keyType) { key(it % BUCKETS) })
    val right =
        pipeline.read(SequenceSource((0 until COUNT).asSequence()))
            .then(KeyBy(keyType) { key((it * 3) % (2 * BUCKETS)) })
    pipeline.join2("Zip", left, right).write(
        object : PSink<PMap<K, Pair<List<Int>, List<Int>>>>() {
          override fun write(input: PMap<K, Pair<List<Int>, List<Int>>>) {
            input.use {
              check(input is Partitionable<*>)
              @Suppress("UNCHECKED_CAST")
              val parts =
                  (input as Partitionable<PEntry<K, Pair<List<Int>, List<Int>>>>).partition(16)
              for (part in parts) {
                if (part.hasNext()) nonEmptyParts += 1
                while (part.hasNext()) {
                  val entry = part.next()
                  val (l, r) = entry.values.single()
                  assertThat(seen.put(entry.key, Pair(l.sorted(), r.sorted()))).isNull()
                }
              }
            }
          }
        })
    pipeline.execute()

    val lefts = (0 until COUNT).groupBy { key(it % BUCKETS) }
    val rights = (0 until COUNT).groupBy { key((it * 3) % (2 * BUCKETS)) }
    val expected =
        (lefts.keys + rights.keys).associateWith {
          Pair((lefts[it] ?: emptyList()).sorted(), (rights[it] ?: emptyList()).sorted())
        }
    assertThat(nonEmptyParts).isGreaterThan(4)
    assertThat(seen).isEqualTo(expected)
  }
}
