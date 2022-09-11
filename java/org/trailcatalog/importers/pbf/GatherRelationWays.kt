package org.trailcatalog.importers.pbf

import com.google.common.geometry.S2Polyline
import com.google.common.reflect.TypeToken
import org.trailcatalog.importers.pipeline.PMapTransformer
import org.trailcatalog.importers.pipeline.collections.Emitter2
import org.trailcatalog.importers.pipeline.collections.PEntry

/**
 * Given a way ID as a key and the pair of <using relation ID, way geometry>,
 * emits a mapping from relation ID to <way ID, way geometry>.
 */
class GatherRelationWays
  : PMapTransformer<
    PEntry<Long, Pair<List<Long>, List<Way>>>,
    Long,
    Pair<Long, S2Polyline>>(
      "GatherRelationWays",
      TypeToken.of(Long::class.java),
      object : TypeToken<Pair<Long, S2Polyline>>() {}) {

  override fun act(
      input: PEntry<Long, Pair<List<Long>, List<Way>>>,
      emitter: Emitter2<Long, Pair<Long, S2Polyline>>) {
    val wayId = input.key
    for (value in input.values) {
      if (value.second.isEmpty()) {
        continue
      }

      val geometry = value.second[0].polyline
      for (relationId in value.first) {
        emitter.emit(relationId, Pair(wayId, geometry))
      }
    }
  }
}
