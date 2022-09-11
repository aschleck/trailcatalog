package org.trailcatalog.importers

import com.google.common.collect.ImmutableMultimap
import com.google.common.collect.ImmutableSetMultimap
import com.google.common.geometry.S2Point
import com.google.common.geometry.S2Polyline
import com.google.common.reflect.TypeToken
import org.slf4j.LoggerFactory
import org.trailcatalog.importers.pbf.Relation
import org.trailcatalog.importers.pipeline.PTransformer
import org.trailcatalog.importers.pipeline.collections.Emitter
import org.trailcatalog.importers.pipeline.collections.PEntry
import org.trailcatalog.models.RelationCategory
import org.trailcatalog.proto.RelationGeometry
import java.util.Stack

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
    if (relation.name.isNullOrBlank()) {
      return
    }
    if (!RelationCategory.TRAIL.isParentOf(relation.type)) {
      return
    }

    val mapped = HashMap<Long, S2Polyline>()
    val ordered = flattenWays(geometries[0], mapped, false)
    val orderedArray = if (ordered == null) {
      logger.warn("Unable to orient ${relation.id}")

      // If we bail here then we just lost basically all the big trails. But our distance
      // computation is fubar for them anyway so does it even matter? I guess it's better to show
      // them wrong than lose them?
      val naive = ArrayList<Long>()
      naiveFlattenWays(geometries[0], naive)
      naive.toLongArray()
    } else {
      ordered.toLongArray()
    }

    if (orderedArray.isEmpty()) {
      logger.warn("Trail ${relation.id} is empty somehow")
      return
    }

    val polyline = pathsToPolyline(orderedArray, mapped)
    emitter.emit(
        Trail(
            relation.id,
            relation.type,
            relation.name,
            orderedArray,
            polyline))
  }
}

/**
 * Returns oriented way IDs in the given relation. Fills in `mapped` (a map from oriented relation
 * and way IDs to latlngs) while running.
 *
 * The naive thing to do is first flatten all the relations to their ways, and then sort. This
 * generally works but breaks down on huge super relations. What we do instead is assume that each
 * child relation makes sense, so we can sort it individually and then treat it as a single polyline
 * higher up in the relations tree. This is not necessarily the case in OSM modeling, but I'm over
 * it.
 *
 * Because we need to get every present way into mapped, we also pass in whether the parent relation
 * failed flattening to the child. This enables skipping sorting on stuff we know will fail.
 */
private fun flattenWays(
    geometry: RelationGeometry,
    mapped: MutableMap<Long, S2Polyline>,
    parentFailed: Boolean): List<Long>? {
  val ids = ArrayList<Long>(geometry.membersList.count { it.hasRelation() || it.hasWay() })
  val childRelations = HashMap<Long, List<Long>>()
  var failed = parentFailed
  for (member in geometry.membersList) {
    if (member.hasNodeId()) {
      // who cares
    } else if (member.hasRelation()) {
      // Note that MAX_VALUE / 2 % 10 is 3.5. So to keep this value even we just add 1.
      val id = member.relation.relationId * 2 + Long.MAX_VALUE / 2 + 1
      val flatChild = flattenWays(member.relation, mapped, failed)
      if (flatChild == null) {
        logger.warn("Unable to orient child relation ${member.relation.relationId}")
        // We can't bail out early because we still need to get every way in the other child
        // relations into mapped
        failed = true
        continue
      }
      ids.add(id)
      childRelations[id] = flatChild
      val childLatLngs = ArrayList<S2Point>()
      for (i in flatChild.indices) {
        val childChildId = flatChild[i]
        val points = mapped[childChildId.and(1L.inv())]!!
        if (points.numVertices() == 0) {
          continue
        }
        val startOffset = if (i == 0) 0 else 1
        val endOffset = if (i == points.numVertices() - 1) 0 else 1
        if (childChildId % 2 == 0L) {
          for (v in startOffset until points.numVertices() - endOffset) {
            childLatLngs.add(points.vertex(v))
          }
        } else {
          for (v in startOffset until points.numVertices() - endOffset) {
            childLatLngs.add(points.vertex(points.numVertices() - 1 - v))
          }
        }
      }
      mapped[id] = S2Polyline(childLatLngs)
    } else if (member.hasWay()) {
      ids.add(2 * member.way.wayId)
      mapped[2 * member.way.wayId] = S2Polyline.decode(member.way.s2Polyline.newInput())
    }
  }

  if (failed) {
    return null
  } else if (ids.isEmpty()) {
    // This is the case where a relation has only a node inside of it?
    return ids
  }

  val oriented = orientPaths(geometry.relationId, ids, mapped) ?: return null
  val flatIds = ArrayList<Long>()
  for (childId in oriented) {
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
  return flatIds
}

private fun naiveFlattenWays(
    geometry: RelationGeometry,
    wayIds: MutableList<Long>) {
  for (member in geometry.membersList) {
    if (member.hasNodeId()) {
      // who cares
    } else if (member.hasRelation()) {
      naiveFlattenWays(member.relation, wayIds)
    } else if (member.hasWay()) {
      wayIds.add(2 * member.way.wayId)
    }
  }
}

private fun orientPaths(
    trailId: Long,
    ordered: List<Long>,
    pathPolylines: Map<Long, S2Polyline>): LongArray? {
  val orientedPathIds = LongArray(ordered.size)
  var globallyAligned = true
  if (ordered.size > 2) {
    for (i in 1 until ordered.size - 1) {
      val previousId = (ordered[i - 1] / 2) * 2
      val id = (ordered[i] / 2) * 2
      val nextId = (ordered[i + 1] / 2) * 2
      val previous = pathPolylines[previousId]!!
      val current = pathPolylines[id]!!
      val next = pathPolylines[nextId]!!
      val forwardIsPreviousForwardAligned =
          checkAligned(previous, false, current, false)
      val forwardIsPreviousReversedAligned =
          checkAligned(previous, true, current, false)
      val forwardIsPreviousAligned =
          forwardIsPreviousForwardAligned || forwardIsPreviousReversedAligned
      val forwardIsNextForwardAligned =
          checkAligned(current, false, next, false)
      val forwardIsNextReversedAligned =
          checkAligned(current, false, next, true)
      val forwardIsNextAligned = forwardIsNextForwardAligned || forwardIsNextReversedAligned
      if (forwardIsPreviousAligned && forwardIsNextAligned) {
        if (forwardIsPreviousForwardAligned) {
          orientedPathIds[i - 1] = previousId
        } else {
          orientedPathIds[i - 1] = previousId + 1
        }
        orientedPathIds[i] = id
        if (forwardIsNextForwardAligned) {
          orientedPathIds[i + 1] = nextId
        } else {
          orientedPathIds[i + 1] = nextId + 1
        }
      } else {
        if (checkAligned(previous, false, current, true)) {
          orientedPathIds[i - 1] = previousId
        } else {
          globallyAligned = globallyAligned && checkAligned(previous, true, current, true)
          orientedPathIds[i - 1] = previousId + 1
        }
        orientedPathIds[i] = id + 1
        if (checkAligned(current, true, next, false)) {
          orientedPathIds[i + 1] = nextId
        } else {
          globallyAligned = globallyAligned && checkAligned(current, true, next, true)
          orientedPathIds[i + 1] = nextId + 1
        }
      }
    }
  } else if (ordered.size == 2) {
    val previousId = (ordered[0] / 2) * 2
    val nextId = (ordered[1] / 2) * 2
    val previous = pathPolylines[previousId]!!
    val next = pathPolylines[nextId]!!
    val forwardIsNextForwardAligned = checkAligned(previous, false, next, false)
    val forwardIsNextReverseAligned = checkAligned(previous, false, next, true)
    if (forwardIsNextForwardAligned || forwardIsNextReverseAligned) {
      orientedPathIds[0] = previousId
      if (forwardIsNextForwardAligned) {
        orientedPathIds[1] = nextId
      } else {
        orientedPathIds[1] = nextId + 1
      }
    } else {
      orientedPathIds[0] = previousId + 1
      if (checkAligned(previous, true, next, false)) {
        orientedPathIds[1] = nextId
      } else {
        orientedPathIds[1] = nextId + 1
      }
    }
  } else {
    orientedPathIds[0] = ordered[0]
  }

  if (globallyAligned) {
    return orientedPathIds
  } else {
    if (globallyAlign(trailId, orientedPathIds, pathPolylines)) {
      return orientedPathIds
    } else {
      return null
    }
  }
}

private fun checkAligned(
    firstVertices: S2Polyline,
    firstReversed: Boolean,
    secondVertices: S2Polyline,
    secondReversed: Boolean,
): Boolean {
  val firstLast = firstVertices.vertex(if (firstReversed) 0 else firstVertices.numVertices() - 1)
  val secondFirst =
      secondVertices.vertex(if (secondReversed) secondVertices.numVertices() - 1 else 0)
  return firstLast == secondFirst
}

private fun globallyAlign(
    trailId: Long, orientedPathIds: LongArray, pathPolylines: Map<Long, S2Polyline>): Boolean {
  // All the possible places we can start a trail from
  val starts = ImmutableSetMultimap.Builder<S2Point, Long>()
  // The count of times a path (forward or reverse) can be used.
  val uses = HashMap<Long, Int>()

  // Seed all possible starts
  for (id in orientedPathIds) {
    val forward = id.and(1L.inv())
    uses[forward] = (uses[forward] ?: 0) + 1
    val polyline = pathPolylines[forward]!!
    starts.put(polyline.vertex(0), forward)
    starts.put(polyline.vertex(polyline.numVertices() - 1), id or 1L)
  }
  val builtStarts = starts.build()

  // Wouldn't it be great if the first path was the start?
  val firstGuess = orientedPathIds[0]
  if (canTracePath(trailId, firstGuess, orientedPathIds, builtStarts, uses, pathPolylines) ||
      canTracePath(trailId, firstGuess xor 1L, orientedPathIds, builtStarts, uses, pathPolylines)) {
    return true
  }

  val startTime = System.currentTimeMillis()
  val timeoutSeconds = 60
  for (start in builtStarts.keys()) {
    if ((System.currentTimeMillis() - startTime) / 1000 > timeoutSeconds) {
      logger.warn(
          "Spent more than ${timeoutSeconds} seconds tracing ${trailId} total, giving up")
      return false
    }

    if (
        canTracePath(
            trailId,
            builtStarts[start].iterator().next(),
            orientedPathIds,
            builtStarts,
            uses,
            pathPolylines)) {
      return true
    }
  }

  return false
}

fun canTracePath(
    trailId: Long,
    start: Long,
    orientedPathIds: LongArray,
    starts: ImmutableMultimap<S2Point, Long>,
    allowedUses: Map<Long, Int>,
    pathPolylines: Map<Long, S2Polyline>): Boolean {
  val stack = Stack<Pair<Long, Int>>()
  val trail = ArrayList<Long>()
  val actualUses = HashMap(allowedUses.keys.map { it to 0 }.toMap())

  stack.push(Pair(start, 1))
  var success = false
  val startTime = System.currentTimeMillis()
  val timeoutSeconds = 30
  while (!stack.isEmpty()) {
    if ((System.currentTimeMillis() - startTime) / 1000 > timeoutSeconds) {
      logger.warn(
          "Spent more than ${timeoutSeconds} seconds tracing ${trailId} starting at ${start}, " +
          "giving up")
      return false
    }

    val (cursor, depth) = stack.pop()
    trail.add(cursor)
    val cursorForward = cursor.and(1L.inv())
    actualUses[cursorForward] = actualUses[cursorForward]!! + 1
    if (depth == orientedPathIds.size) {
      success = true
      break
    }

    while (trail.size > depth) {
      val forward = trail.removeLast().and(1L.inv())
      actualUses[forward] = actualUses[forward]!! - 1
    }

    val polyline = pathPolylines[cursor and 1L.inv()]!!
    val end = if ((cursor and 1L) == 0L) {
      polyline.vertex(polyline.numVertices() - 1)
    } else {
      polyline.vertex(0)
    }
    for (candidate in starts[end]) {
      val forward = candidate and 1L.inv()
      // Check to make sure if we use this candidate we haven't exceeded our uses
      if (actualUses[forward]!! < allowedUses[forward]!!) {
        stack.push(Pair(candidate, depth + 1))
      }
    }
  }

  return if (success) {
    for (i in 0 until orientedPathIds.size) {
      orientedPathIds[i] = trail[i]
    }
    true
  } else {
    false
  }
}

private fun pathsToPolyline(
    orientedPathIds: LongArray,
    pathPolylines: HashMap<Long, S2Polyline>): S2Polyline {
  val polyline = ArrayList<S2Point>()
  for (pathIndex in orientedPathIds.indices) {
    val pathId = orientedPathIds[pathIndex]
    val path = pathPolylines[pathId.and(1L.inv())]!!
    val startOffset = if (pathIndex == 0) 0 else 1
    val endOffset = if (pathIndex == orientedPathIds.size - 1) 0 else 1
    if (pathId % 2 == 0L) {
      for (i in startOffset until path.numVertices() - endOffset) {
        polyline.add(path.vertex(i))
      }
    } else {
      for (i in (path.numVertices() - 1 - endOffset) downTo startOffset) {
        polyline.add(path.vertex(i))
      }
    }
  }
  return S2Polyline(polyline)
}
