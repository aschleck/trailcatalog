package org.trailcatalog.pbf

import com.google.protobuf.ByteString
import crosby.binary.Osmformat.PrimitiveBlock
import crosby.binary.Osmformat.PrimitiveGroup
import crosby.binary.Osmformat.Relation
import crosby.binary.Osmformat.Relation.MemberType.NODE
import crosby.binary.Osmformat.Relation.MemberType.RELATION
import crosby.binary.Osmformat.Relation.MemberType.WAY
import crosby.binary.Osmformat.StringTable
import java.nio.charset.StandardCharsets
import org.apache.commons.text.StringEscapeUtils.escapeCsv
import org.trailcatalog.models.RelationCategory
import org.trailcatalog.proto.RelationMemberFunction.INNER
import org.trailcatalog.proto.RelationMemberFunction.OUTER
import org.trailcatalog.proto.RelationSkeleton
import org.trailcatalog.proto.RelationSkeletonMember

class RelationsCsvInputStream(block: PrimitiveBlock) : PbfEntityInputStream(
    block,
    "id,type,name,relation_skeleton\n".toByteArray(StandardCharsets.UTF_8),
) {

  override fun convertToCsv(group: PrimitiveGroup, csv: StringBuilder) {
    for (relation in group.relationsList) {
      val data = getRelationData(relation, block.stringtable)
      csv.append(relation.id)
      csv.append(",")
      csv.append(data.type.id)
      csv.append(",")
      if (data.name != null) {
        csv.append(escapeCsv(data.name))
      }
      csv.append(",")
      appendByteArray(relationToSkeleton(relation, block.stringtable).toByteArray(), csv)
      csv.append("\n")
    }
  }
}

data class RelationData(
  val type: RelationCategory,
  val name: String?,
)

fun getRelationData(relation: Relation, stringTable: StringTable): RelationData {
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
  return RelationData(type = category, name = name)
}

private val BS_INNER = ByteString.copyFromUtf8("inner")

fun relationToSkeleton(relation: Relation, stringTable: StringTable): RelationSkeleton {
  var memberId = 0L
  val skeleton = RelationSkeleton.newBuilder()
  for (i in 0 until relation.memidsCount) {
    memberId += relation.getMemids(i)
    val inner = stringTable.getS(relation.getRolesSid(i)) == BS_INNER

    when (relation.getTypes(i)) {
      NODE -> {
        // these are things like trailheads and labels (r237599), so ignore them
      }
      RELATION -> {
        skeleton.addMembers(
            RelationSkeletonMember.newBuilder()
                .setFunction(if (inner) INNER else OUTER)
                .setRelationId(memberId))
      }
      WAY -> {
        skeleton.addMembers(
            RelationSkeletonMember.newBuilder()
                .setFunction(if (inner) INNER else OUTER)
                .setWayId(memberId))
      }
      null -> {}
    }
  }
  return skeleton.build()
}