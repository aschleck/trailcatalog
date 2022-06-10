package org.trailcatalog.importers.pbf

import com.google.common.reflect.TypeToken
import org.trailcatalog.importers.pipeline.PMapTransformer
import org.trailcatalog.importers.pipeline.collections.Emitter2
import org.trailcatalog.importers.pipeline.collections.PEntry
import org.trailcatalog.proto.RelationGeometry
import org.trailcatalog.proto.RelationMember.ValueCase.NODE_ID
import org.trailcatalog.proto.RelationMember.ValueCase.RELATION
import org.trailcatalog.proto.RelationMember.ValueCase.WAY

class ExtractWayRelationPairs : PMapTransformer<PEntry<Long, RelationGeometry>, Long, Long>(
    "ExtractWayRelationPairs",
    TypeToken.of(Long::class.java),
    TypeToken.of(Long::class.java),
) {

  override fun act(input: PEntry<Long, RelationGeometry>, emitter: Emitter2<Long, Long>) {
    if (input.values.isEmpty()) {
      return
    }

    val geometry = input.values[0]
    inflate(input.key, geometry, emitter)
  }

  override fun estimateRatio(): Double {
    return 1.0
  }
}

private fun inflate(
    root: Long,
    geometry: RelationGeometry,
    emitter: Emitter2<Long, Long>,
) {
  for (member in geometry.membersList) {
    when (member.valueCase) {
      NODE_ID -> {}
      RELATION -> inflate(root, member.relation, emitter)
      WAY -> emitter.emit(member.way.wayId, root)
      else -> throw AssertionError()
    }
  }
}
