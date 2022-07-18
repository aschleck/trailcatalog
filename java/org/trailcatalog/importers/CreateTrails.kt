package org.trailcatalog.importers

import com.google.common.collect.ImmutableMultimap
import com.google.common.collect.ImmutableSetMultimap
import com.google.common.geometry.S2Point
import com.google.common.geometry.S2Polyline
import com.google.common.reflect.TypeToken
import com.sun.org.slf4j.internal.LoggerFactory
import org.trailcatalog.importers.pbf.LatLngE7
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

    val ordered = ArrayList<Long>()
    val mapped = HashMap<Long, List<LatLngE7>>()
    flattenWays(geometries[0], ordered, mapped)
    if (ordered.isEmpty()) {
      logger.warn("Trail ${relation.id} is empty somehow")
      return
    }
    var orientedPathIds = orientPaths(relation.id, ordered, mapped)
    if (orientedPathIds == null) {
      logger.warn("Unable to orient ${relation.id}")
      orientedPathIds = ordered.toLongArray()
    }
    val polyline = pathsToPolyline(orientedPathIds, mapped)
    emitter.emit(
        Trail(
            relation.id,
            relation.type,
            relation.name,
            orientedPathIds,
            polyline))
  }
}

private fun flattenWays(
    geometry: RelationGeometry,
    ordered: MutableList<Long>,
    mapped: MutableMap<Long, List<LatLngE7>>) {
  for (member in geometry.membersList) {
    if (member.hasNodeId()) {
      // who cares
    } else if (member.hasRelation()) {
      flattenWays(member.relation, ordered, mapped)
    } else if (member.hasWay()) {
      ordered.add(2 * member.way.wayId)
      val raw = member.way.latLngE7List
      val latLngs = ArrayList<LatLngE7>(member.way.latLngE7Count / 2)
      for (i in 0 until member.way.latLngE7Count step 2) {
        latLngs.add(LatLngE7(raw[i], raw[i + 1]))
      }
      mapped[2 * member.way.wayId] = latLngs
    }
  }
}

private fun orientPaths(
    trailId: Long,
    ordered: List<Long>,
    pathPolylines: HashMap<Long, List<LatLngE7>>): LongArray? {
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
    firstVertices: List<LatLngE7>,
    firstReversed: Boolean,
    secondVertices: List<LatLngE7>,
    secondReversed: Boolean,
): Boolean {
  val firstLast =
      if (firstReversed) {
        firstVertices[0]
      } else {
        firstVertices[firstVertices.size - 1]
      }
  val secondFirst =
      if (secondReversed) {
        secondVertices[secondVertices.size - 1]
      } else {
        secondVertices[0]
      }
  return firstLast == secondFirst
}

private fun globallyAlign(
    trailId: Long, orientedPathIds: LongArray, pathPolylines: Map<Long, List<LatLngE7>>): Boolean {
  // All the possible places we can start a trail from
  val starts = ImmutableSetMultimap.Builder<LatLngE7, Long>()
  // The count of times a path (forward or reverse) can be used.
  val uses = HashMap<Long, Int>()

  // Seed all possible starts
  for (id in orientedPathIds) {
    val forward = id.and(1L.inv())
    uses[forward] = (uses[forward] ?: 0) + 1
    val polyline = pathPolylines[forward]!!
    starts.put(polyline[0], forward)
    starts.put(polyline[polyline.size - 1], id or 1L)
  }
  val builtStarts = starts.build()

  // Wouldn't it be great if the first path was the start?
  val firstGuess = orientedPathIds[0]
  if (canTracePath(trailId, firstGuess, orientedPathIds, builtStarts, uses, pathPolylines) ||
      canTracePath(trailId, firstGuess xor 1L, orientedPathIds, builtStarts, uses, pathPolylines)) {
    return true
  }

  for (start in builtStarts.keys()) {
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
    starts: ImmutableMultimap<LatLngE7, Long>,
    allowedUses: Map<Long, Int>,
    pathPolylines: Map<Long, List<LatLngE7>>): Boolean {
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
      polyline[polyline.size - 1]
    } else {
      polyline[0]
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
    pathPolylines: HashMap<Long, List<LatLngE7>>): S2Polyline {
  val polyline = ArrayList<S2Point>()
  for (pathId in orientedPathIds) {
    val path = pathPolylines[(pathId / 2) * 2]!!
    if (pathId % 2 == 0L) {
      for (i in 0 until path.size) {
        polyline.add(path[i].toS2LatLng().toPoint())
      }
    } else {
      for (i in (path.size - 1) downTo 0) {
        polyline.add(path[i].toS2LatLng().toPoint())
      }
    }
  }
  return S2Polyline(polyline)
}
