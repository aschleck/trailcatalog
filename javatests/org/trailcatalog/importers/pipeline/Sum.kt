package org.trailcatalog.importers.pipeline

import com.google.common.reflect.TypeToken
import org.trailcatalog.importers.pipeline.collections.Emitter
import org.trailcatalog.importers.pipeline.collections.PEntry

class Sum : PTransformer<PEntry<Int, Pair<List<Int>, List<Int>>>, Int>(TypeToken.of(Int::class.java)) {

  override fun act(input: PEntry<Int, Pair<List<Int>, List<Int>>>, emitter: Emitter<Int>) {
    var sum = 0
    for (p in input.values) {
      sum += p.first.sumOf { it }
      sum += p.second.sumOf { it }
    }
    emitter.emit(sum)
  }

}