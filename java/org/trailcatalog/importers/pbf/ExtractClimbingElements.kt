package org.trailcatalog.importers.pbf

import crosby.binary.Osmformat
import crosby.binary.Osmformat.Relation.MemberType.NODE
import crosby.binary.Osmformat.Relation.MemberType.RELATION
import crosby.binary.Osmformat.Relation.MemberType.WAY
import crosby.binary.Osmformat.StringTable
import org.trailcatalog.models.RelationCategory
import org.trailcatalog.proto.RelationSkeleton
import org.trailcatalog.proto.RelationSkeletonMember

// Node and way ids overlap relation ids, and a site drawn as a relation keeps the relation's id
// like every other boundary, so sites drawn as nodes or ways move into ranges that no OSM id
// reaches. OSM ids are below 2^35, and the offsets keep every id below 2^53 so that JavaScript
// numbers hold it exactly. Keep in sync with types.ts#Boundary.
private const val WAY_SITE_ID_OFFSET = 1L shl 40
private const val NODE_SITE_ID_OFFSET = 2L shl 40

fun nodeSiteId(nodeId: Long): Long = NODE_SITE_ID_OFFSET + nodeId

fun waySiteId(wayId: Long): Long = WAY_SITE_ID_OFFSET + wayId

/** Returns the way a site id names, or null if it names a node or relation. */
fun siteWayId(siteId: Long): Long? =
    if (siteId in WAY_SITE_ID_OFFSET until NODE_SITE_ID_OFFSET) {
      siteId - WAY_SITE_ID_OFFSET
    } else {
      null
    }

private val EMPTY_MEMBERS = RelationSkeleton.getDefaultInstance()

/** Returns the climbing element a node is, or null if it isn't one. */
fun climbingNode(
    id: Long, kvs: List<Int>, latLng: LatLngE7, stringTable: StringTable): ClimbingElement? {
  val type = climbingCategory(kvs, stringTable)
  if (type == RelationCategory.ANY) {
    return null
  }
  return element(nodeSiteId(id), type, kvs, stringTable, latLng, EMPTY_MEMBERS)
}

/** Returns the climbing element a way is, or null if it isn't one. */
fun climbingWay(way: Osmformat.Way, stringTable: StringTable): ClimbingElement? {
  val kvs = wayKvs(way)
  val type = climbingCategory(kvs, stringTable)
  if (type == RelationCategory.ANY) {
    return null
  }
  return element(waySiteId(way.id), type, kvs, stringTable, null, EMPTY_MEMBERS)
}

/**
 * Returns the climbing element a relation is with every member, because routes are usually nodes,
 * or null if it isn't one.
 */
fun climbingRelation(relation: Osmformat.Relation, stringTable: StringTable): ClimbingElement? {
  val kvs = ArrayList<Int>(2 * relation.keysCount)
  for (i in 0 until relation.keysCount) {
    kvs.add(relation.getKeys(i))
    kvs.add(relation.getVals(i))
  }
  val type = climbingCategory(kvs, stringTable)
  if (type == RelationCategory.ANY) {
    return null
  }

  val members = RelationSkeleton.newBuilder()
  var memberId = 0L
  for (i in 0 until relation.memidsCount) {
    memberId += relation.getMemids(i)
    val member = RelationSkeletonMember.newBuilder()
    when (relation.getTypes(i)) {
      NODE -> member.setNodeId(memberId)
      RELATION -> member.setRelationId(memberId)
      WAY -> member.setWayId(memberId)
      null -> continue
    }
    members.addMembers(member)
  }
  return element(relation.id, type, kvs, stringTable, null, members.build())
}

/**
 * Returns the boundary a climbing site becomes, [RelationCategory.BOUNDARY_CLIMBING] for an element
 * that only shapes the sites holding it, or [RelationCategory.ANY].
 */
fun climbingCategory(kvs: List<Int>, stringTable: StringTable): RelationCategory {
  var category = RelationCategory.ANY
  for (i in 0 until kvs.size step 2) {
    val value = stringTable.getS(kvs[i + 1])
    when (stringTable.getS(kvs[i])) {
      CLIMBING_BS ->
        category =
            category
                .coerceAtLeast(RelationCategory.BOUNDARY_CLIMBING)
                .coerceAtLeast(CLIMBING_SITE_CATEGORY_NAMES[value])
      // A boulder drawn as natural=stone is often only tagged sport=climbing.
      // https://wiki.openstreetmap.org/wiki/Semi-colon_value_separator
      SPORT_BS ->
        if (value.toStringUtf8().split(';').any { it.trim() == "climbing" }) {
          category = category.coerceAtLeast(RelationCategory.BOUNDARY_CLIMBING)
        }
    }
  }
  return category
}

private fun element(
    id: Long,
    type: RelationCategory,
    kvs: List<Int>,
    stringTable: StringTable,
    latLng: LatLngE7?,
    members: RelationSkeleton): ClimbingElement {
  return ClimbingElement(
      id,
      type.id,
      tagName(kvs, stringTable) ?: "",
      tagNames(kvs, stringTable),
      latLng,
      members)
}
