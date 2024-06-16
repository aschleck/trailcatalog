package org.trailcatalog.importers.basemap

import de.westnordost.osmapi.OsmConnection
import de.westnordost.osmapi.map.MapDataApi
import de.westnordost.osmapi.map.data.Element
import org.trailcatalog.importers.pbf.LatLngE7
import org.trailcatalog.importers.pbf.toIntE7
import org.trailcatalog.proto.RelationGeometry
import org.trailcatalog.proto.RelationMember
import org.trailcatalog.proto.RelationMemberFunction
import org.trailcatalog.proto.WayGeometry
import kotlin.system.exitProcess

fun main(args: Array<String>) {
  test(fetchRelation(args[0].toLong()))
}

fun fetchRelation(id: Long): RelationGeometry {
  val osm =
    OsmConnection("https://api.openstreetmap.org/api/0.6/", "trailcatalog.org relation checker")
  return fetchRelation(id, MapDataApi(osm))
}

private fun fetchRelation(id: Long, map: MapDataApi): RelationGeometry {
  println("Fetching relation ${id}")
  val relation = RelationGeometry.newBuilder().setRelationId(id)
  val source = map.getRelation(id)
  for (member in source.members) {
    when (member.role) {
      // Keep in sync with ExtractRelations#relationToSkeleton
      "backward" -> "outer"
      "forward" -> "outer"
      "inner" -> "inner"
      "outer" -> "outer"
      "subarea" -> "outer"
      "empty" -> "outer"
      "" -> "outer"
      else -> continue
    }

    relation.addMembers(
      RelationMember.newBuilder()
        .setFunction(RelationMemberFunction.OUTER)
        .also {
          when (member.type) {
            Element.Type.NODE -> it.setNodeId(member.ref)
            Element.Type.WAY -> it.setWay(fetchWay(member.ref, map))
            Element.Type.RELATION -> it.setRelation(fetchRelation(member.ref, map))
          }
        })
  }
  return relation.build()
}

private fun fetchWay(id: Long, map: MapDataApi): WayGeometry {
  println("Fetching way ${id}")
  val source = map.getWay(id)
  val unsorted = map.getNodes(source.nodeIds).associateBy { it.id }
  val nodes = source.nodeIds.map { unsorted[it]!! }
  return WayGeometry.newBuilder()
    .setWayId(id)
    .addAllLatLngE7(
      nodes.flatMap {
        listOf(it.position.latitude.toIntE7(), it.position.longitude.toIntE7())
      }
    )
    .build()
}

private fun test(relation: RelationGeometry) {
  val mapped = HashMap<Long, List<LatLngE7>>()
  val ways = HashMap<Long, WayGeometry>()
  val flattened = flattenWays(relation, mapped, ways, false)
  if (flattened != null) {
    println("relation ${relation.relationId} is valid")
    println(flattened)
  } else {
    println("relation ${relation.relationId} failed")
    val children = ArrayList<Long>()
    for (member in relation.membersList) {
      if (member.hasRelation()) {
        children.add(member.relation.relationId)
        test(member.relation)
      }
    }

    println("entering repl...")
    println(
      "direct children: "
          + children.map { it * 2 + Long.MAX_VALUE / 2 + 1 }.joinToString(", "))

    while (true) {
      print("r${relation.relationId}> ")

      val line = readlnOrNull() ?: break
      if (line[0] == 'q') {
        break
      } else if (line[0] == 'i') {
        val id = line.substring(1).trim().toLong()
        println("item ${id}")
        println("node count: " + mapped[id]!!.size)
        println("first position: " + mapped[id]!!.first().toS2LatLng().toStringDegrees())
        println("last position: " + mapped[id]!!.last().toS2LatLng().toStringDegrees())
      }
    }

    exitProcess(1)
  }
}