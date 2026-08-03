package org.trailcatalog.importers.basemap

import com.google.common.geometry.S2Point
import com.google.common.geometry.S2Polyline
import com.google.common.reflect.TypeToken
import org.slf4j.LoggerFactory
import org.trailcatalog.importers.pbf.LatLngE7
import org.trailcatalog.importers.pbf.Relation
import org.trailcatalog.importers.pipeline.PTransformer
import org.trailcatalog.importers.pipeline.collections.Emitter
import org.trailcatalog.importers.pipeline.collections.PEntry
import org.trailcatalog.models.RelationCategory
import org.trailcatalog.proto.RelationGeometry
import org.trailcatalog.proto.WayGeometry

private val logger = LoggerFactory.getLogger(CreateTrails::class.java)

class CreateTrails
  : PTransformer<PEntry<Long, Pair<List<Relation>, List<RelationGeometry>>>, Trail>(
    TypeToken.of(Trail::class.java)) {

  override fun act(
      input: PEntry<Long, Pair<List<Relation>, List<RelationGeometry>>>,
      emitter: Emitter<Trail>) {
    val (relations, geometries) = input.values[0]
    if (relations.isEmpty() || geometries.isEmpty()) {
      return
    }

    val relation = relations[0]
    // If no one bothered to give this a name, it's probably not worth being shown
    if (relation.name.isNullOrBlank()) {
      return
    }
    if (!RelationCategory.TRAIL.isParentOf(relation.type)) {
      return
    }

    val mapped = HashMap<Long, List<LatLngE7>>()
    val ways = HashMap<Long, WayGeometry>()
    val flattened = flattenWays(geometries[0], mapped, ways)
    if (flattened.ids.isEmpty()) {
      logger.warn("Trail ${relation.id} is empty somehow")
      return
    }
    if (!flattened.continuous) {
      logger.warn("Trail ${relation.id} does not trace as one line")
    }

    val orderedArray = flattened.ids.toLongArray()
    val polyline = pathsToPolyline(orderedArray, mapped)
    var downMeters = 0f
    var upMeters = 0f
    var lengthMeters = 0.0
    for (pathId in orderedArray) {
      val way = ways[pathId / 2]
      if (way == null) {
        downMeters = Float.NaN
        upMeters = Float.NaN
        lengthMeters = Double.NaN
        break
      }

      if (pathId.and(1L) == 0L) {
        downMeters += way.downMeters
        upMeters += way.upMeters
      } else {
        downMeters += way.upMeters
        upMeters += way.downMeters
      }
      // Summing the ways rather than measuring the joined polyline, because only the ways carry the
      // elevation the trail climbs over.
      lengthMeters += way.lengthMeters
    }

    emitter.emit(
        Trail(
            relation.id,
            relation.type,
            relation.name,
            relation.names,
            orderedArray,
            polyline,
            downMeters,
            upMeters,
            lengthMeters.toFloat(),
            flattened.continuous,
        ))
  }
}

/** Oriented way IDs in traversal order, and whether they trace as one continuous line. */
class FlatWays(val ids: List<Long>, val continuous: Boolean)

/**
 * Returns oriented way IDs in the given relation. Fills in `mapped` (a map from oriented relation
 * and way IDs to latlngs) while running.
 *
 * The naive thing to do is first flatten all the relations to their ways, and then sort. This
 * generally works but breaks down on huge super relations. What we do instead is assume that each
 * child relation makes sense, so we can sort it individually and then treat it as a single polyline
 * higher up in the relations tree. This is not necessarily the case in OSM modeling, but I'm over
 * it.
 */
fun flattenWays(
    geometry: RelationGeometry,
    mapped: MutableMap<Long, List<LatLngE7>>,
    ways: MutableMap<Long, WayGeometry>): FlatWays {
  val ids = ArrayList<Long>(geometry.membersList.count { it.hasRelation() || it.hasWay() })
  val childRelations = HashMap<Long, List<Long>>()
  var continuous = true
  for (member in geometry.membersList) {
    if (member.hasNodeId()) {
      // who cares
    } else if (member.hasRelation()) {
      // Note that MAX_VALUE / 2 % 10 is 3.5. So to keep this value even we just add 1.
      val id = member.relation.relationId * 2 + Long.MAX_VALUE / 2 + 1
      val child = flattenWays(member.relation, mapped, ways)
      continuous = continuous && child.continuous
      ids.add(id)
      childRelations[id] = child.ids
      val childLatLngs = ArrayList<LatLngE7>()
      for (childChildId in child.ids) {
        val points = mapped[childChildId.and(1L.inv())]!!
        if (points.size < 2) {
          continue
        }
        val direction = if (childChildId % 2 == 0L) {
          points
        } else {
          points.reversed()
        }
        // A child that traces as one line repeats the shared node, but one that breaks does not,
        // and dropping a vertex there would cut the corner.
        val startOffset = if (childLatLngs.lastOrNull() == direction[0]) 1 else 0
        childLatLngs.addAll(direction.subList(startOffset, direction.size))
      }
      mapped[id] = childLatLngs
    } else if (member.hasWay()) {
      ids.add(2 * member.way.wayId)
      val raw = member.way.latLngE7List
      val latLngs = ArrayList<LatLngE7>(member.way.latLngE7Count / 2)
      for (i in 0 until member.way.latLngE7Count step 2) {
        latLngs.add(LatLngE7(raw[i], raw[i + 1]))
      }
      mapped[2 * member.way.wayId] = latLngs
      ways[member.way.wayId] = member.way
    }
  }

  val filtered = ids.filter { mapped[it]!!.isNotEmpty() }
  if (filtered.isEmpty()) {
    // This is the case where a relation has only a node inside of it?
    return FlatWays(filtered, continuous)
  }

  val oriented = orientPaths(filtered, mapped)
  val flatIds = ArrayList<Long>()
  for (childId in oriented.ids) {
    if (childId >= Long.MAX_VALUE / 2) {
      val childIds = childRelations[childId.and(1L.inv())]!!
      if (childId % 2 == 0L) {
        flatIds.addAll(childIds)
      } else {
        childIds.reversed().forEach { flatIds.add(it.xor(1L)) }
      }
    } else {
      flatIds.add(childId)
    }
  }
  return FlatWays(flatIds, continuous && oriented.continuous)
}

// A maximal stretch of ways that meet nose to tail at vertices where nothing else joins, so it has
// no choices inside it.
private class Run(
    val ids: List<Long>, val start: LatLngE7, val end: LatLngE7, val meters: Double)

// A run in a chain, reversed when the chain walks it end to start.
private class Step(val run: Int, val reversed: Boolean)

private class Chain(val ids: List<Long>, val meters: Double)

private class OrientedPaths(val ids: LongArray, val continuous: Boolean)

/**
 * Walks the ways of a relation nose to tail, setting the low bit on the ones that run backwards.
 *
 * Ordering every way into one line is an Eulerian path problem. We chain up the stretches that
 * have no choice in them, hang those on each other longest first, and splice in the detours that
 * come back, which finds one line whenever one exists. Relations that branch have no such line at
 * all, and there taking the longest first leaves the main line whole and puts the spurs after it.
 */
private fun orientPaths(
    ordered: List<Long>, pathPolylines: Map<Long, List<LatLngE7>>): OrientedPaths {
  val incident = HashMap<LatLngE7, MutableList<Int>>()
  for (i in ordered.indices) {
    val points = pathPolylines[ordered[i]]!!
    incident.getOrPut(points.first()) { ArrayList() }.add(i)
    incident.getOrPut(points.last()) { ArrayList() }.add(i)
  }

  // First, gather the runs
  val walked = BooleanArray(ordered.size)
  // The way carrying on through a vertex, or null at a trail end or a junction. Junctions are a
  // choice and we make those later, once we know how long each run is.
  val carryOn = { vertex: LatLngE7 ->
    val at = incident[vertex]!!
    if (at.size == 2) {
      val candidate = if (walked[at[0]]) at[1] else at[0]
      if (walked[candidate]) null else candidate
    } else {
      null
    }
  }
  val runs = ArrayList<Run>()
  for (seed in ordered.indices) {
    if (walked[seed]) {
      continue
    }

    walked[seed] = true
    val ids = ArrayDeque<Long>()
    ids.addLast(ordered[seed])
    var meters = latLngsToMeters(pathPolylines[ordered[seed]]!!)
    var start = pathPolylines[ordered[seed]]!!.first()
    var end = pathPolylines[ordered[seed]]!!.last()
    while (true) {
      val next = carryOn(end) ?: break
      walked[next] = true
      val points = pathPolylines[ordered[next]]!!
      meters += latLngsToMeters(points)
      if (points.first() == end) {
        ids.addLast(ordered[next])
        end = points.last()
      } else {
        ids.addLast(ordered[next] or 1L)
        end = points.first()
      }
    }
    while (true) {
      val next = carryOn(start) ?: break
      walked[next] = true
      val points = pathPolylines[ordered[next]]!!
      meters += latLngsToMeters(points)
      if (points.last() == start) {
        ids.addFirst(ordered[next])
        start = points.first()
      } else {
        ids.addFirst(ordered[next] or 1L)
        start = points.last()
      }
    }
    runs.add(Run(ids, start, end, meters))
  }

  // Now hang the runs off each other
  val endpoints = HashMap<LatLngE7, MutableList<Int>>()
  for (i in runs.indices) {
    endpoints.getOrPut(runs[i].start) { ArrayList() }.add(i)
    endpoints.getOrPut(runs[i].end) { ArrayList() }.add(i)
  }
  val hung = BooleanArray(runs.size)
  val longestAt = { vertex: LatLngE7 ->
    endpoints[vertex]!!.filter { !hung[it] }.maxByOrNull { runs[it].meters }
  }
  // A vertex the walk already passed through can still have runs waiting on it, and those are
  // reachable only as a detour that comes back. Anything that does not come back would tear the
  // chain in two, so we leave it for a chain of its own.
  val detourFrom = { vertex: LatLngE7 ->
    val walk = ArrayList<Step>()
    var cursor = vertex
    var next = longestAt(vertex)
    while (next != null) {
      val attach = next
      hung[attach] = true
      val reversed = runs[attach].start != cursor
      walk.add(Step(attach, reversed))
      cursor = if (reversed) runs[attach].start else runs[attach].end
      next = if (cursor == vertex) null else longestAt(cursor)
    }
    if (walk.isNotEmpty() && cursor == vertex) {
      walk
    } else {
      walk.forEach { hung[it.run] = false }
      null
    }
  }

  val chains = ArrayList<Chain>()
  for (seed in runs.indices.sortedByDescending { runs[it].meters }) {
    if (hung[seed]) {
      continue
    }

    hung[seed] = true
    val steps = ArrayList<Step>()
    steps.add(Step(seed, false))
    var start = runs[seed].start
    var end = runs[seed].end
    while (true) {
      val next = longestAt(end) ?: break
      hung[next] = true
      val reversed = runs[next].start != end
      steps.add(Step(next, reversed))
      end = if (reversed) runs[next].start else runs[next].end
    }
    while (true) {
      val next = longestAt(start) ?: break
      hung[next] = true
      val reversed = runs[next].end != start
      steps.add(0, Step(next, reversed))
      start = if (reversed) runs[next].end else runs[next].start
    }

    var at = 0
    while (at <= steps.size) {
      val vertex = if (at < steps.size) {
        val step = steps[at]
        if (step.reversed) runs[step.run].end else runs[step.run].start
      } else {
        end
      }
      val detour = detourFrom(vertex)
      if (detour == null) {
        at += 1
      } else {
        steps.addAll(at, detour)
      }
    }

    val ids = ArrayList<Long>()
    var meters = 0.0
    for (step in steps) {
      meters += runs[step.run].meters
      if (step.reversed) {
        runs[step.run].ids.reversed().forEach { ids.add(it.xor(1L)) }
      } else {
        ids.addAll(runs[step.run].ids)
      }
    }
    chains.add(Chain(ids, meters))
  }

  chains.sortByDescending { it.meters }
  val ids = LongArray(ordered.size)
  var at = 0
  for (chain in chains) {
    for (id in chain.ids) {
      ids[at] = id
      at += 1
    }
  }
  return OrientedPaths(ids, chains.size == 1)
}

private fun pathsToPolyline(
    orientedPathIds: LongArray,
    pathPolylines: Map<Long, List<LatLngE7>>): S2Polyline {
  val polyline = ArrayList<S2Point>()
  var last: LatLngE7? = null
  for (pathId in orientedPathIds) {
    val path = pathPolylines[pathId.and(1L.inv())]!!
    val direction = if (pathId % 2 == 0L) {
      path
    } else {
      path.asReversed()
    }
    for (point in direction) {
      // S2Polyline rejects repeated vertices, and consecutive ways share the node they meet at.
      if (point != last) {
        polyline.add(point.toS2LatLng().toPoint())
        last = point
      }
    }
  }
  return S2Polyline(polyline)
}
