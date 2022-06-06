package org.trailcatalog.importers.pbf

import com.google.common.reflect.TypeToken
import com.google.protobuf.ByteString
import crosby.binary.Osmformat
import crosby.binary.Osmformat.PrimitiveBlock
import crosby.binary.Osmformat.Relation.MemberType.NODE
import crosby.binary.Osmformat.Relation.MemberType.RELATION
import crosby.binary.Osmformat.Relation.MemberType.WAY
import crosby.binary.Osmformat.StringTable
import org.trailcatalog.importers.pipeline.PTransformer
import org.trailcatalog.importers.pipeline.collections.Emitter
import org.trailcatalog.models.RelationCategory
import org.trailcatalog.proto.RelationMemberFunction.INNER
import org.trailcatalog.proto.RelationMemberFunction.OUTER
import org.trailcatalog.proto.RelationSkeleton
import org.trailcatalog.proto.RelationSkeletonMember

class ExtractRelations : PTransformer<PrimitiveBlock, Relation>(TypeToken.of(Relation::class.java)) {

  override fun act(input: PrimitiveBlock, emitter: Emitter<Relation>) {
    for (group in input.primitivegroupList) {
      for (relation in group.relationsList) {
        val converted = getRelation(relation, input.stringtable)
        if (converted.type != RelationCategory.ANY.id) {
          emitter.emit(converted)
        }
      }
    }
  }

  override fun estimateRatio(): Double {
    return 0.01
  }
}

fun getRelation(relation: Osmformat.Relation, stringTable: StringTable): Relation {
  var category = RelationCategory.ANY
  var name: String? = null
  var network: String? = null
  var ref: String? = null
  for (i in 0 until relation.keysCount) {
    val key = relation.getKeys(i)
    when (stringTable.getS(key)) {
      ADMIN_LEVEL_BS ->
        category =
            category
                .coerceAtLeast(RelationCategory.BOUNDARY_ADMINISTRATIVE)
                .coerceAtLeast(ADMINISTRATIVE_LEVEL_NAMES[stringTable.getS(relation.getVals(i))])
      BOUNDARY_BS ->
        category =
            category
                .coerceAtLeast(RelationCategory.BOUNDARY)
                .coerceAtLeast(BOUNDARY_CATEGORY_NAMES[stringTable.getS(relation.getVals(i))])
      NAME_BS ->
        name = stringTable.getS(relation.getVals(i)).toStringUtf8()
      NETWORK_BS ->
        network = stringTable.getS(relation.getVals(i)).toStringUtf8()
      PROTECT_CLASS_BS ->
        category =
            category
                .coerceAtLeast(RelationCategory.BOUNDARY_PROTECTED_AREA)
                .coerceAtLeast(PROTECT_CLASS_NAMES[stringTable.getS(relation.getVals(i))])
      REF_BS ->
        ref = stringTable.getS(relation.getVals(i)).toStringUtf8()
      ROUTE_BS ->
        category =
            category
                .coerceAtLeast(RelationCategory.ROUTE)
                .coerceAtLeast(ROUTE_CATEGORY_NAMES[stringTable.getS(relation.getVals(i))])
    }
  }
  if (name == null && network != null && ref != null) {
    name = "${network} ${ref}"
  }
  return Relation(relation.id, category.id, name ?: "", relationToSkeleton(relation, stringTable))
}

private val INNER_BS = ByteString.copyFromUtf8("inner")

fun relationToSkeleton(relation: Osmformat.Relation, stringTable: StringTable): RelationSkeleton {
  var memberId = 0L
  val skeleton = RelationSkeleton.newBuilder()
  for (i in 0 until relation.memidsCount) {
    memberId += relation.getMemids(i)
    val inner = stringTable.getS(relation.getRolesSid(i)) == INNER_BS

    when (relation.getTypes(i)) {
      NODE -> skeleton.addMembers(RelationSkeletonMember.newBuilder().setNodeId(memberId))
      RELATION ->
        skeleton.addMembers(
            RelationSkeletonMember.newBuilder()
                .setFunction(if (inner) INNER else OUTER)
                .setRelationId(memberId))
      WAY ->
        skeleton.addMembers(
            RelationSkeletonMember.newBuilder()
                .setFunction(if (inner) INNER else OUTER)
                .setWayId(memberId))
      null -> {}
    }
  }
  return skeleton.build()
}