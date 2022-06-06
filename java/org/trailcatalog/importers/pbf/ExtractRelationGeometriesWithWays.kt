package org.trailcatalog.importers.pbf

import com.google.common.reflect.TypeToken
import org.trailcatalog.importers.pipeline.PStage
import org.trailcatalog.importers.pipeline.collections.Emitter2
import org.trailcatalog.importers.pipeline.collections.PMap
import org.trailcatalog.importers.pipeline.collections.createPMap
import org.trailcatalog.proto.RelationGeometry
import org.trailcatalog.proto.RelationMember
import org.trailcatalog.proto.RelationSkeleton
import org.trailcatalog.proto.RelationSkeletonMember.ValueCase.NODE_ID
import org.trailcatalog.proto.RelationSkeletonMember.ValueCase.RELATION_ID
import org.trailcatalog.proto.RelationSkeletonMember.ValueCase.WAY_ID
import org.trailcatalog.proto.WayGeometry

class ExtractRelationGeometriesWithWays
  : PStage<PMap<Long, Relation>, PMap<Long, RelationGeometry>>() {

  override fun act(input: PMap<Long, Relation>): () -> PMap<Long, RelationGeometry> {
    return createPMap(
        TypeToken.of(Long::class.java),
        TypeToken.of(RelationGeometry::class.java),
        estimateSize(input.estimatedByteSize())) { emitter ->
      val inMemory = HashMap<Long, RelationSkeleton>()
      while (input.hasNext()) {
        val relation = input.next().values[0]
        inMemory[relation.id] = relation.skeleton
      }

      val used = HashSet<Long>()
      for (id in inMemory.keys) {
        val geometry = inflate(id, inMemory, used) ?: continue
        emitter.emit(id, geometry)
        used.clear()
      }
    }
  }
}

private fun inflate(
    id: Long,
    relations: Map<Long, RelationSkeleton>,
    used: MutableSet<Long>,
): RelationGeometry? {
  if (used.contains(id)) {
    println("relation ${id} was has a cyclic usage")
    return null
  }

  used.add(id)
  val skeleton = relations[id] ?: return null
  val geometry = RelationGeometry.newBuilder()
  for (member in skeleton.membersList) {
    when (member.valueCase) {
      NODE_ID -> geometry.addMembers(RelationMember.newBuilder().setNodeId(member.nodeId))
      RELATION_ID ->
          geometry.addMembers(
              RelationMember.newBuilder()
                  .setFunction(member.function)
                  .setRelation(
                      inflate(member.relationId, relations, used) ?: return null))
      WAY_ID ->
        geometry.addMembers(
            RelationMember.newBuilder()
                .setFunction(member.function)
                .setWay(WayGeometry.newBuilder().setWayId(member.wayId)))
      else -> throw AssertionError()
    }
  }
  return geometry.build()
}
