package org.trailcatalog.importers.pbf

import com.google.common.reflect.TypeToken
import java.util.Stack
import org.trailcatalog.importers.pipeline.collections.DisposableSupplier
import org.trailcatalog.importers.pipeline.PStage
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

  override fun act(
      input: PMap<Long, Relation>,
      dependants: Int): DisposableSupplier<PMap<Long, RelationGeometry>> {
    return createPMap(
        "ExtractRelationGeometriesWithWays",
        TypeToken.of(Long::class.java),
        TypeToken.of(RelationGeometry::class.java),
        estimateSize(input.estimatedByteSize())) { emitter ->
      // How big can this really be anyway...?
      val inMemory = HashMap<Long, RelationSkeleton>()
      while (input.hasNext()) {
        val relation = input.next().values[0]
        inMemory[relation.id] = relation.skeleton
      }
      input.close()

      val used = Stack<Long>()
      for (id in inMemory.keys) {
        used.clear()
        val geometry = inflate(id, id, inMemory, used) ?: continue
        emitter.emit(id, geometry)
      }
    }
  }
}

private fun inflate(
    id: Long,
    from: Long,
    relations: Map<Long, RelationSkeleton>,
    used: Stack<Long>,
): RelationGeometry? {
  if (used.contains(id)) {
    println("relation ${id} has a cyclic usage from ${from}")
    return null
  }

  val skeleton = relations[id] ?: return null

  // Pushing after the lookup keeps a member that has no skeleton from leaving its id on the stack,
  // which the check above would then read as a cycle in the members after it.
  used.push(id)
  val geometry = RelationGeometry.newBuilder().setRelationId(id)
  for (member in skeleton.membersList) {
    when (member.valueCase) {
      NODE_ID -> geometry.addMembers(RelationMember.newBuilder().setNodeId(member.nodeId))
      RELATION_ID -> {
        // A member we can't inflate leaves a hole, but the rest of the geometry is still worth
        // having, and returning null here would erase this relation and every relation using it.
        val inflated = inflate(member.relationId, from, relations, used) ?: continue
        geometry.addMembers(
            RelationMember.newBuilder().setFunction(member.function).setRelation(inflated))
      }
      WAY_ID ->
        geometry.addMembers(
            RelationMember.newBuilder()
                .setFunction(member.function)
                .setWay(WayGeometry.newBuilder().setWayId(member.wayId)))
      else -> throw AssertionError()
    }
  }
  used.pop()
  return geometry.build()
}
