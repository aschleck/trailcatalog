package org.trailcatalog.importers.pipeline

import com.google.common.reflect.TypeToken
import com.google.common.truth.Truth.assertThat
import org.junit.Test
import org.trailcatalog.importers.pipeline.collections.Emitter
import org.trailcatalog.importers.pipeline.collections.Emitter2
import org.trailcatalog.importers.pipeline.collections.PCollection
import org.trailcatalog.importers.pipeline.collections.PEntry
import org.trailcatalog.importers.pipeline.collections.PMap

/**
 * Exercises the worker-pool variants of PTransformer and PMapTransformer added in the
 * parallel-extract work. The contract is "same output, possibly different order" — PMap
 * outputs are sorted by key so they remain identical to the serial path; PList outputs are
 * unordered so we compare as multisets.
 */
class ParallelismTest {

  private class IdentityMap(override val parallelism: Int)
    : PMapTransformer<Int, Int, Int>(
        "IdentityMap", TypeToken.of(Int::class.java), TypeToken.of(Int::class.java)) {
    override fun act(input: Int, emitter: Emitter2<Int, Int>) {
      emitter.emit(input, input)
    }
  }

  private class FanOutMap(private val fanOut: Int, override val parallelism: Int)
    : PMapTransformer<Int, Int, Int>(
        "FanOutMap", TypeToken.of(Int::class.java), TypeToken.of(Int::class.java)) {
    override fun act(input: Int, emitter: Emitter2<Int, Int>) {
      for (i in 0 until fanOut) {
        emitter.emit(input, input * 100 + i)
      }
    }
  }

  private class DoubleTransform(override val parallelism: Int)
    : PTransformer<Int, Int>(TypeToken.of(Int::class.java)) {
    override fun act(input: Int, emitter: Emitter<Int>) {
      emitter.emit(input * 2)
    }
  }

  private class FanOutTransform(private val fanOut: Int, override val parallelism: Int)
    : PTransformer<Int, Int>(TypeToken.of(Int::class.java)) {
    override fun act(input: Int, emitter: Emitter<Int>) {
      for (i in 0 until fanOut) {
        emitter.emit(input * 100 + i)
      }
    }
  }

  // ----- PMapTransformer -----

  @Test
  fun pmapParallelMatchesSerial_smallInput() {
    val items = (0 until 50)
    val serial = runMapAndCollect(items, parallelism = 1)
    val parallel = runMapAndCollect(items, parallelism = 4)
    // PMap is sorted by key, so order must match exactly.
    assertThat(parallel).isEqualTo(serial)
  }

  @Test
  fun pmapParallelMatchesSerial_largeInput() {
    // Larger than PARALLEL_BATCH_SIZE (1024) so multiple batches are dispatched per worker.
    val items = (0 until 5000)
    val serial = runMapAndCollect(items, parallelism = 1)
    val parallel = runMapAndCollect(items, parallelism = 8)
    assertThat(parallel).isEqualTo(serial)
  }

  @Test
  fun pmapParallelEmptyInput() {
    val out = ArrayList<String>()
    val pipeline = Pipeline(parallelism = 4)
    pipeline.read(SequenceSource(emptySequence<Int>()))
        .then(IdentityMap(parallelism = Int.MAX_VALUE))
        .write(MapSink(out))
    pipeline.execute()
    assertThat(out).isEmpty()
  }

  @Test
  fun pmapParallelSingleItem() {
    val out = ArrayList<String>()
    val pipeline = Pipeline(parallelism = 4)
    pipeline.read(SequenceSource(sequenceOf(42)))
        .then(IdentityMap(parallelism = Int.MAX_VALUE))
        .write(MapSink(out))
    pipeline.execute()
    assertThat(out).containsExactly("PEntry(key=42, values=[42])")
  }

  @Test
  fun pmapParallelMultiEmitPerItem() {
    val items = (0 until 100)
    val serial = runFanOutMapAndCollect(items, fanOut = 5, parallelism = 1)
    val parallel = runFanOutMapAndCollect(items, fanOut = 5, parallelism = 4)
    assertThat(parallel).isEqualTo(serial)
  }

  // ----- PTransformer -----

  @Test
  fun ptransformerParallelMatchesSerial_smallInput() {
    val items = (0 until 50)
    val serial = runTransformAndCollect(items, parallelism = 1)
    val parallel = runTransformAndCollect(items, parallelism = 4)
    // PList is unordered (emits may be interleaved across workers), so compare as multisets.
    assertThat(parallel.sorted()).isEqualTo(serial.sorted())
  }

  @Test
  fun ptransformerParallelMatchesSerial_largeInput() {
    val items = (0 until 5000)
    val serial = runTransformAndCollect(items, parallelism = 1)
    val parallel = runTransformAndCollect(items, parallelism = 8)
    assertThat(parallel.sorted()).isEqualTo(serial.sorted())
  }

  @Test
  fun ptransformerParallelEmptyInput() {
    val out = ArrayList<String>()
    val pipeline = Pipeline(parallelism = 4)
    // Multi-shot (write to two sinks) so the parallel multi-shot path is exercised.
    val stage =
        pipeline.read(SequenceSource(emptySequence<Int>()))
            .then(DoubleTransform(parallelism = Int.MAX_VALUE))
    stage.write(ListSink(out))
    stage.write(ListSink(ArrayList()))
    pipeline.execute()
    assertThat(out).isEmpty()
  }

  @Test
  fun ptransformerParallelMultiEmitPerItem() {
    val items = (0 until 100)
    val serial = runFanOutTransformAndCollect(items, fanOut = 5, parallelism = 1)
    val parallel = runFanOutTransformAndCollect(items, fanOut = 5, parallelism = 4)
    assertThat(parallel.sorted()).isEqualTo(serial.sorted())
  }

  // ----- Stress -----

  @Test
  fun pmapStressMany() {
    // Drive a lot of items through enough workers that every queue path gets exercised.
    val items = (0 until 20_000)
    val out = ArrayList<String>()
    val pipeline = Pipeline(parallelism = 8)
    pipeline.read(SequenceSource(items.asSequence()))
        .then(IdentityMap(parallelism = Int.MAX_VALUE))
        .write(MapSink(out))
    pipeline.execute()
    assertThat(out).hasSize(20_000)
    assertThat(out[0]).isEqualTo("PEntry(key=0, values=[0])")
    assertThat(out.last()).isEqualTo("PEntry(key=19999, values=[19999])")
  }

  // ----- Helpers -----

  /** PSink that collects PMap entries into a list of strings. */
  private class MapSink(val out: MutableList<String>) : PSink<PMap<Int, Int>>() {
    override fun write(input: PMap<Int, Int>) {
      while (input.hasNext()) {
        out.add(input.next().toString())
      }
      input.close()
    }
  }

  /** PSink that collects PList values into a list of strings. */
  private class ListSink(val out: MutableList<String>) : PSink<PCollection<Int>>() {
    override fun write(input: PCollection<Int>) {
      while (input.hasNext()) {
        out.add(input.next().toString())
      }
      input.close()
    }
  }

  private fun runMapAndCollect(items: IntRange, parallelism: Int): List<String> {
    val out = ArrayList<String>()
    val pipeline = Pipeline(parallelism = parallelism)
    pipeline.read(SequenceSource(items.asSequence()))
        .then(IdentityMap(parallelism = parallelism))
        .write(MapSink(out))
    pipeline.execute()
    return out
  }

  private fun runFanOutMapAndCollect(items: IntRange, fanOut: Int, parallelism: Int): List<String> {
    val out = ArrayList<String>()
    val pipeline = Pipeline(parallelism = parallelism)
    pipeline.read(SequenceSource(items.asSequence()))
        .then(FanOutMap(fanOut = fanOut, parallelism = parallelism))
        .write(MapSink(out))
    pipeline.execute()
    return out
  }

  private fun runTransformAndCollect(items: IntRange, parallelism: Int): List<String> {
    val out = ArrayList<String>()
    val pipeline = Pipeline(parallelism = parallelism)
    // Multi-shot to force the parallel materializing path. write() adds one consumer; we add
    // a second sink reading from the same stage to push it above the oneshot threshold.
    val stage =
        pipeline.read(SequenceSource(items.asSequence()))
            .then(DoubleTransform(parallelism = parallelism))
    stage.write(ListSink(out))
    stage.write(ListSink(ArrayList()))
    pipeline.execute()
    return out
  }

  private fun runFanOutTransformAndCollect(
      items: IntRange,
      fanOut: Int,
      parallelism: Int,
  ): List<String> {
    val out = ArrayList<String>()
    val pipeline = Pipeline(parallelism = parallelism)
    val stage =
        pipeline.read(SequenceSource(items.asSequence()))
            .then(FanOutTransform(fanOut = fanOut, parallelism = parallelism))
    stage.write(ListSink(out))
    stage.write(ListSink(ArrayList()))
    pipeline.execute()
    return out
  }
}
