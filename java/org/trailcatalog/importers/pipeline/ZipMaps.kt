package org.trailcatalog.importers.pipeline

import com.google.common.collect.ImmutableList
import com.google.common.reflect.TypeParameter
import com.google.common.reflect.TypeToken
import org.trailcatalog.importers.pipeline.collections.DisposableSupplier
import org.trailcatalog.importers.pipeline.collections.Emitter2
import org.trailcatalog.importers.pipeline.collections.PMap
import org.trailcatalog.importers.pipeline.collections.createPMap

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

  override fun act(input: Pair<PMap<K, V1>, PMap<K, V2>>):
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
}
