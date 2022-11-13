package org.trailcatalog.importers.basemap

import com.google.common.reflect.TypeToken
import org.trailcatalog.importers.pbf.Relation
import org.trailcatalog.importers.pipeline.PMapTransformer
import org.trailcatalog.importers.pipeline.collections.Emitter2
import org.trailcatalog.importers.pipeline.collections.PEntry
import org.trailcatalog.models.RelationCategory
import org.trailcatalog.proto.RelationGeometry

class ExtractWaysFromTrailRelations
  : PMapTransformer<PEntry<Long, Pair<List<Relation>, List<RelationGeometry>>>, Long, Long>(
    "ExtractWaysFromTrailRelations",
    TypeToken.of(Long::class.java),
    TypeToken.of(Long::class.java)) {

  override fun act(
      input: PEntry<Long, Pair<List<Relation>, List<RelationGeometry>>>,
      emitter: Emitter2<Long, Long>) {
    for (value in input.values) {
      val isTrail = value.first.any { RelationCategory.TRAIL.isParentOf(it.type) }
      if (isTrail) {
        value.second.forEach { emitWays(it, emitter) }
      }
    }
  }

  private fun emitWays(relation: RelationGeometry, emitter: Emitter2<Long, Long>) {
    for (member in relation.membersList) {
      if (member.hasRelation()) {
        emitWays(member.relation, emitter)
      }
      if (member.hasWay()) {
        emitter.emit(member.way.wayId, member.way.wayId)
      }
    }
  }
}
