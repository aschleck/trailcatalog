package org.trailcatalog.importers.pbf

import com.google.common.reflect.TypeToken
import org.trailcatalog.importers.pipeline.PMapTransformer
import org.trailcatalog.importers.pipeline.collections.Emitter2
import org.trailcatalog.importers.pipeline.collections.PEntry

class GatherWayNodes : PMapTransformer<PEntry<Long, Pair<List<Node>, List<Long>>>, Long, Node>(
    TypeToken.of(Long::class.java), TypeToken.of(Node::class.java)) {

  override fun act(input: PEntry<Long, Pair<List<Node>, List<Long>>>, emitter: Emitter2<Long, Node>) {
    for (value in input.values) {
      if (value.first.isEmpty()) {
        continue
      }

      val node = value.first[0]
      for (way in value.second) {
        emitter.emit(way, node)
      }
    }
  }
}