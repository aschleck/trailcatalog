package org.trailcatalog.importers.pbf

import com.google.common.geometry.S2Polyline
import com.google.common.reflect.TypeToken
import com.google.protobuf.ByteString
import java.nio.ByteBuffer
import java.nio.ByteOrder
import org.trailcatalog.importers.pipeline.PMapTransformer
import org.trailcatalog.importers.pipeline.collections.Emitter2
import org.trailcatalog.importers.pipeline.collections.PEntry
import org.trailcatalog.importers.pipeline.io.ByteBufferEncodedOutputStream
import org.trailcatalog.proto.RelationGeometry
import org.trailcatalog.proto.RelationMember
import org.trailcatalog.proto.RelationMember.ValueCase.NODE_ID
import org.trailcatalog.proto.RelationMember.ValueCase.RELATION
import org.trailcatalog.proto.RelationMember.ValueCase.WAY
import org.trailcatalog.proto.WayGeometry

private val BYTE_BUFFER = ByteBuffer.allocate(1 * 1024 * 1024).order(ByteOrder.LITTLE_ENDIAN)

class MakeRelationGeometries
  : PMapTransformer<
      PEntry<Long, Pair<List<RelationGeometry>, List<Pair<Long, S2Polyline>>>>,
      Long,
      RelationGeometry>(
    "MakeRelationGeometries",
    TypeToken.of(Long::class.java),
    object : TypeToken<RelationGeometry>() {}) {

  override fun act(
      input: PEntry<Long, Pair<List<RelationGeometry>, List<Pair<Long, S2Polyline>>>>,
      emitter: Emitter2<Long, RelationGeometry>) {
    val relationId = input.key
    val partial =
        input.values.stream().flatMap { it.first.stream() }.findFirst().orElse(null) ?: return

    val ways = HashMap<Long, S2Polyline>()
    for (value in input.values) {
      for ((wayId, geometry) in value.second) {
        ways[wayId] = geometry
      }
    }

    val geometry = inflate(partial, ways) ?: return
    emitter.emit(relationId, geometry)
  }

  override fun estimateRatio(): Double {
    return 1.0
  }
}

private fun inflate(
    partial: RelationGeometry,
    ways: Map<Long, S2Polyline>): RelationGeometry? {
  val geometry = RelationGeometry.newBuilder().setRelationId(partial.relationId)
  for (member in partial.membersList) {
    when (member.valueCase) {
      NODE_ID -> geometry.addMembers(RelationMember.newBuilder().setNodeId(member.nodeId))
      RELATION ->
        geometry.addMembers(
            RelationMember.newBuilder()
                .setFunction(member.function)
                .setRelation(inflate(member.relation, ways) ?: return null))
      WAY -> {
        val wayId = member.way.wayId
        (ways[wayId] ?: return null).encodeCompact(ByteBufferEncodedOutputStream(BYTE_BUFFER))
        val polylineBytes = ByteString.copyFrom(BYTE_BUFFER.flip())
        BYTE_BUFFER.clear()
        val way = WayGeometry.newBuilder().setWayId(wayId).setS2Polyline(polylineBytes)
        geometry.addMembers(RelationMember.newBuilder().setFunction(member.function).setWay(way))
      }
      else -> throw AssertionError()
    }
  }
  return geometry.build()
}
