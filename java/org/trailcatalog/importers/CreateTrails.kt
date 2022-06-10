package org.trailcatalog.importers

import com.google.common.collect.ImmutableMultimap
import com.google.common.geometry.S2Point
import com.google.common.geometry.S2Polyline
import com.google.common.reflect.TypeToken
import org.trailcatalog.importers.pbf.LatLngE7
import org.trailcatalog.importers.pbf.Relation
import org.trailcatalog.importers.pipeline.PTransformer
import org.trailcatalog.importers.pipeline.collections.Emitter
import org.trailcatalog.importers.pipeline.collections.PEntry
import org.trailcatalog.models.RelationCategory
import org.trailcatalog.proto.RelationGeometry
import org.trailcatalog.s2.boundToCell
import java.util.Stack

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
    val orientedPathIds = orientPaths(ordered, mapped)
    val polyline = pathsToPolyline(orientedPathIds, mapped)
    val cell = boundToCell(polyline.rectBound).id()
    val center = polyline.interpolate(0.5).toLatLngE7()
    emitter.emit(
        Trail(
            relation.id,
            relation.type,
            cell,
            relation.name,
            orientedPathIds,
            center,
            polylineToMeters(polyline)))
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
    ordered: List<Long>,
    pathPolylines: HashMap<Long, List<LatLngE7>>): LongArray {
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

  if (!globallyAligned) {
    globallyAlign(orientedPathIds, pathPolylines)
  }

  return orientedPathIds
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
    orientedPathIds: LongArray, pathPolylines: Map<Long, List<LatLngE7>>) {
  val starts = ImmutableMultimap.Builder<LatLngE7, Long>()
  val uses = HashMap<Long, Int>()
  for (id in orientedPathIds) {
    val forward = id and 1L.inv()
    uses[forward] = (uses[forward] ?: 0) + 1
    val polyline = pathPolylines[forward]!!
    starts.put(polyline[0], forward)
    starts.put(polyline[polyline.size - 1], id or 1L)
  }

  val builtStarts = starts.build()
  val firstGuess = orientedPathIds[0]
  if (canTracePath(firstGuess, orientedPathIds, builtStarts, uses, pathPolylines) ||
      canTracePath(firstGuess xor 1L, orientedPathIds, builtStarts, uses, pathPolylines)) {
    return
  }

  for (start in builtStarts.keys()) {
    if (builtStarts[start].size > 1) {
      continue
    }
    if (
        canTracePath(
            builtStarts[start].iterator().next(),
            orientedPathIds,
            builtStarts,
            uses,
            pathPolylines)) {
      return
    }
  }
}

fun canTracePath(
    start: Long,
    orientedPathIds: LongArray,
    starts: ImmutableMultimap<LatLngE7, Long>,
    uses: Map<Long, Int>,
    pathPolylines: Map<Long, List<LatLngE7>>): Boolean {
  val stack = Stack<Pair<Long, Int>>()
  val trail = ArrayList<Long>()
  stack.push(Pair(start, 1))
  var success = false
  while (!stack.isEmpty()) {
    val (cursor, depth) = stack.pop()
    trail.add(cursor)
    if (depth == orientedPathIds.size) {
      success = true
      break
    }

    while (trail.size > depth) {
      trail.removeLast()
    }

    val polyline = pathPolylines[cursor and 1L.inv()]!!
    val end = if ((cursor and 1L) == 0L) {
      polyline[polyline.size - 1]
    } else {
      polyline[0]
    }
    for (candidate in starts[end]) {
      val forward = candidate and 1L.inv()
      if (trail.count { stop -> forward == (stop and 1L.inv()) } < uses[forward] ?: 0) {
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
