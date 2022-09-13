package org.trailcatalog.importers.pipeline

import com.google.common.collect.ImmutableList
import com.google.common.reflect.TypeParameter
import com.google.common.reflect.TypeToken
import org.trailcatalog.importers.pipeline.collections.DisposableSupplier
import org.trailcatalog.importers.pipeline.collections.Emitter2
import org.trailcatalog.importers.pipeline.collections.PEntry
import org.trailcatalog.importers.pipeline.collections.PMap
import org.trailcatalog.importers.pipeline.collections.createPMap
import java.util.concurrent.atomic.AtomicInteger

class ZipMaps2<K : Comparable<K>, V1 : Any, V2 : Any>(
    private val context: String,
    private val keyType: TypeToken<K>,
    private val v1Type: TypeToken<V1>,
    private val v2Type: TypeToken<V2>,
)
  : PStage<Pair<PMap<K, V1>, PMap<K, V2>>, PMap<K, Pair<List<V1>, List<V2>>>>() {

  override fun estimateRatio(): Double {
    return 1.0
  }

  override fun act(input: Pair<PMap<K, V1>, PMap<K, V2>>, dependants: Int):
      DisposableSupplier<PMap<K, Pair<List<V1>, List<V2>>>> {
    return if (dependants > 1) {
      actMultishot(input)
    } else {
      actOneshot(input)
    }
  }

  private fun actMultishot(input: Pair<PMap<K, V1>, PMap<K, V2>>):
      DisposableSupplier<PMap<K, Pair<List<V1>, List<V2>>>> {
    val estimate =
        (estimateRatio() * (input.first.estimatedByteSize() + input.second.estimatedByteSize()))
            .toLong()
    val pairType =
        (object : TypeToken<Pair<List<V1>, List<V2>>>() {})
            .where(object : TypeParameter<V1>() {}, v1Type)
            .where(object : TypeParameter<V2>() {}, v2Type)
    return createPMap(
        context,
        keyType,
        pairType,
        estimate) { emitter ->
      zip(input, emitter)
    }
  }

  private fun zip(
      input: Pair<PMap<K, V1>, PMap<K, V2>>, emitter: Emitter2<K, Pair<List<V1>, List<V2>>>) {
    val left = input.first
    val right = input.second

    var nl = if (left.hasNext()) left.next() else null
    var nr = if (right.hasNext()) right.next() else null

    while (nl != null && nr != null) {
      when (nl.key.compareTo(nr.key)) {
        -1 -> {
          emitter.emit(nl.key, Pair(nl.values, ImmutableList.of()))
          nl = if (left.hasNext()) left.next() else null
        }
        0 -> {
          emitter.emit(nl.key, Pair(nl.values, nr.values))
          nl = if (left.hasNext()) left.next() else null
          nr = if (right.hasNext()) right.next() else null
        }
        1 -> {
          emitter.emit(nl.key, Pair(ImmutableList.of(), nr.values))
          nr = if (right.hasNext()) right.next() else null
        }
        else -> throw AssertionError("Unknown compareTo return value")
      }
    }

    while (nl != null) {
      emitter.emit(nl.key, Pair(nl.values, ImmutableList.of()))
      nl = if (left.hasNext()) left.next() else null
    }

    while (nr != null) {
      emitter.emit(nr.key, Pair(ImmutableList.of(), nr.values))
      nr = if (right.hasNext()) right.next() else null
    }

    left.close()
    right.close()
  }

  private fun actOneshot(input: Pair<PMap<K, V1>, PMap<K, V2>>):
      DisposableSupplier<PMap<K, Pair<List<V1>, List<V2>>>> {
    val left = input.first
    val right = input.second
    val openCount = AtomicInteger(0)

    return DisposableSupplier<PMap<K, Pair<List<V1>, List<V2>>>>({ }) {
      if (openCount.incrementAndGet() != 1) {
        throw RuntimeException("Oneshot zip can only be used once")
      }

      println("${context} (zipping oneshot)")
      object : PMap<K, Pair<List<V1>, List<V2>>> {
        var nl = if (left.hasNext()) left.next() else null
        var nr = if (right.hasNext()) right.next() else null

        override fun estimatedByteSize(): Long {
          return (
              estimateRatio() * (input.first.estimatedByteSize() + input.second.estimatedByteSize()))
              .toLong()
        }

        override fun close() {
          left.close()
          right.close()
        }

        override fun hasNext(): Boolean {
          return nl != null && nr != null
        }

        override fun next(): PEntry<K, Pair<List<V1>, List<V2>>> {
          val nl = this.nl
          val nr = this.nr

          val entry: PEntry<K, Pair<List<V1>, List<V2>>>
          if (nl != null && nr != null) {
            when (nl.key.compareTo(nr.key)) {
              -1 -> {
                entry = PEntry(nl.key, ImmutableList.of(Pair(nl.values, ImmutableList.of())))
                this.nl = if (left.hasNext()) left.next() else null
              }
              0 -> {
                entry = PEntry(nl.key, ImmutableList.of(Pair(nl.values, nr.values)))
                this.nl = if (left.hasNext()) left.next() else null
                this.nr = if (right.hasNext()) right.next() else null
              }
              1 -> {
                entry = PEntry(nl.key, ImmutableList.of(Pair(ImmutableList.of(), nr.values)))
                this.nr = if (right.hasNext()) right.next() else null
              }
              else -> throw AssertionError("Unknown compareTo return value")
            }
          } else if (nl != null) {
            entry = PEntry(nl.key, ImmutableList.of(Pair(nl.values, ImmutableList.of())))
            this.nl = if (left.hasNext()) left.next() else null
          } else if (nr != null) {
            entry = PEntry(nr.key, ImmutableList.of(Pair(ImmutableList.of(), nr.values)))
            this.nr = if (right.hasNext()) right.next() else null
          } else {
            throw AssertionError("next was called when none remain")
          }
          return entry
        }
      }
    }
  }
}

