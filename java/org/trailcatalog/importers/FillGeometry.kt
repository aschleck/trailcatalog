package org.trailcatalog.importers

import com.google.common.collect.ImmutableMultimap
import com.google.common.geometry.S2LatLng
import com.google.common.geometry.S2Point
import com.google.common.geometry.S2Polygon
import com.google.common.geometry.S2PolygonBuilder
import com.google.common.geometry.S2PolygonBuilder.Options
import com.google.common.geometry.S2Polyline
import com.zaxxer.hikari.HikariDataSource
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.runBlocking
import org.trailcatalog.pbf.NodeRecord
import org.trailcatalog.proto.RelationGeometry
import org.trailcatalog.proto.RelationMemberFunction.INNER
import org.trailcatalog.proto.RelationMemberFunction.OUTER
import org.trailcatalog.s2.boundToCell
import org.trailcatalog.s2.earthMeters
import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder.LITTLE_ENDIAN
import java.nio.DoubleBuffer
import java.nio.LongBuffer
import java.util.Stack
import java.sql.Connection

fun fillInGeometry(hikari: HikariDataSource) {
  hikari.connection.use {
    fillInBoundaries(it)
    fillInTrails(it)
  }
}

private fun fillInBoundaries(connection: Connection) {
  val getBoundaries =
    connection.prepareStatement(
        "SELECT id, relation_geometry FROM boundaries WHERE cell = -1 AND length(relation_geometry) > 0"
    )
  val getNodes =
    connection.prepareStatement("SELECT id, lat_degrees, lng_degrees FROM nodes WHERE id = ANY (?)")
  val updateBoundary =
    connection.prepareStatement(
        "UPDATE boundaries SET cell = ?, s2_polygon = ? WHERE id = ?"
    )

  val results = getBoundaries.executeQuery()

  ProgressBar("filling in boundaries", "boundaries").use { progress ->
    var batchSize = 0
    while (results.next()) {
      val boundaryId = results.getLong(1)
      val geometry = RelationGeometry.parseFrom(results.getBytes(2))

      val nodeResults = getNodes.apply {
        val nodes = ArrayList<Long>()
        flattenNodesInto(geometry, nodes)
        setArray(1, connection.createArrayOf("bigint", nodes.toArray()))
      }.executeQuery()
      val nodePositions = HashMap<Long, NodeRecord>()
      while (nodeResults.next()) {
        nodePositions[nodeResults.getLong(1)] =
            NodeRecord(nodeResults.getDouble(2), nodeResults.getDouble(3))
      }

      val polygon = geometryToPolygon(geometry, nodePositions)
      val polygonBytes = ByteArrayOutputStream()
      polygon.encode(polygonBytes)
      val bound = polygon.rectBound
      if (bound.isEmpty || bound.isFull) {
        println("Boundary ${boundaryId} has a fubar bound")
        continue
      }

      updateBoundary.apply {
        setLong(1, boundToCell(bound).id())
        setBytes(2, polygonBytes.toByteArray())
        setLong(3, boundaryId)
        addBatch()
        batchSize += 1
        progress.increment()
      }

      if (batchSize >= 1000) {
        updateBoundary.executeBatch()
        batchSize = 0
      }
    }

    updateBoundary.executeBatch()
  }
}

private fun fillInTrails(connection: Connection) {
  val getTrails =
      connection.prepareStatement(
          "SELECT id, path_ids FROM trails WHERE cell = -1 AND length(path_ids) > 0")
  val getPaths =
      connection.prepareStatement("SELECT id, lat_lng_degrees FROM paths WHERE id = ANY (?)")
  val updateTrail =
      connection.prepareStatement(
          "UPDATE trails SET cell = ?, center_lat_degrees = ?, center_lng_degrees = ?, "
                  + "length_meters = ?, path_ids = ? WHERE id = ?")

  val results = getTrails.executeQuery()
  val scope = CoroutineScope(Dispatchers.Default)

  ProgressBar("filling in trails", "trails").use { progress ->
    if (!results.isBeforeFirst) {
      return
    }

    val batch = ArrayList<Pair<Long, ByteArray>>()
    val toLookup = HashSet<Long>()
    val pathPolylines = HashMap<Long, DoubleBuffer>()

    while (!results.isAfterLast) {
      batch.clear()
      toLookup.clear()
      pathPolylines.clear()

      var i = 0
      while (i < 1000 && results.next()) {
        val trailId = results.getLong(1)
        val pathBytes = results.getBytes(2)

        val originalPathIds = ByteBuffer.wrap(pathBytes).order(LITTLE_ENDIAN).asLongBuffer()
        while (originalPathIds.hasRemaining()) {
          toLookup.add((originalPathIds.get() / 2) * 2) // make sure we get the forward direction
        }

        batch.add(Pair(trailId, pathBytes))
        i += 1
      }

      getPaths.apply {
        setArray(1, connection.createArrayOf("bigint", toLookup.toArray()))
      }.executeQuery().use {
        while (it.next()) {
          pathPolylines[it.getLong(1)] =
              ByteBuffer.wrap(it.getBytes(2)).order(LITTLE_ENDIAN).asDoubleBuffer()
        }
      }

      runBlocking {
        batch.map { (id, pathBytes) ->
          scope.async {
            val paths = ByteBuffer.wrap(pathBytes).order(LITTLE_ENDIAN).asLongBuffer()
            val pathIds = LongArray(pathBytes.size / 8)

            var present = true
            var count = 0
            while (paths.hasRemaining()) {
              val pathId = paths.get()
              if (!pathPolylines.containsKey((pathId / 2) * 2)) {
                present = false
                break
              }
              pathIds[count] = pathId
              count += 1
            }
            if (!present) {
              return@async
            }
            paths.rewind()

            val orientedPathIdBytes = orientPaths(pathIds, pathPolylines)
            val s2Polyline = pathsToPolyline(orientedPathIdBytes, pathPolylines)
            orientedPathIdBytes.rewind()
            val center = S2LatLng(s2Polyline.interpolate(0.5))

            synchronized(updateTrail) {
              updateTrail.apply {
                setLong(1, boundToCell(s2Polyline.rectBound).id())
                setDouble(2, center.latDegrees())
                setDouble(3, center.lngDegrees())
                setDouble(4, s2Polyline.arclengthAngle.earthMeters())
                setBytes(5, orientedPathIdBytes.array())
                setLong(6, id)
                addBatch()
              }
            }

            progress.increment()
          }
        }.forEach { it.await() }
      }

      synchronized (updateTrail) {
        updateTrail.executeBatch()
      }
    }
  }
}

private fun pathsToPolyline(
    orientedPathIdBytes: ByteBuffer,
    pathPolylines: HashMap<Long, DoubleBuffer>): S2Polyline {
  val polyline = ArrayList<S2Point>()
  while (orientedPathIdBytes.hasRemaining()) {
    val pathId = orientedPathIdBytes.getLong()
    val path = pathPolylines[(pathId / 2) * 2]!!
    if (pathId % 2 == 0L) {
      for (i in (0 until path.capacity()).step(2)) {
        polyline.add(S2LatLng.fromDegrees(path[i], path[i + 1]).toPoint())
      }
    } else {
      for (i in ((path.capacity() - 2) downTo 0).step(2)) {
        polyline.add(S2LatLng.fromDegrees(path[i], path[i + 1]).toPoint())
      }
    }
  }
  return S2Polyline(polyline)
}

private fun orientPaths(
    pathArray: LongArray,
    pathPolylines: HashMap<Long, DoubleBuffer>): ByteBuffer {
  val orientedPathIdBytes =
    ByteBuffer.allocate(pathArray.size * 8).order(LITTLE_ENDIAN)
  val orientedPathIds = orientedPathIdBytes.asLongBuffer()
  var globallyAligned = true
  if (pathArray.size > 2) {
    for (i in 1 until pathArray.size - 1) {
      val previousId = (pathArray[i - 1] / 2) * 2
      val id = (pathArray[i] / 2) * 2
      val nextId = (pathArray[i + 1] / 2) * 2
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
          orientedPathIds.put(i - 1, previousId)
        } else {
          orientedPathIds.put(i - 1, previousId + 1)
        }
        orientedPathIds.put(i, id)
        if (forwardIsNextForwardAligned) {
          orientedPathIds.put(i + 1, nextId)
        } else {
          orientedPathIds.put(i + 1, nextId + 1)
        }
      } else {
        if (checkAligned(previous, false, current, true)) {
          orientedPathIds.put(i - 1, previousId)
        } else {
          globallyAligned = globallyAligned && checkAligned(previous, true, current, true)
          orientedPathIds.put(i - 1, previousId + 1)
        }
        orientedPathIds.put(i, id + 1)
        if (checkAligned(current, true, next, false)) {
          orientedPathIds.put(i + 1, nextId)
        } else {
          globallyAligned = globallyAligned && checkAligned(current, true, next, true)
          orientedPathIds.put(i + 1, nextId + 1)
        }
      }
    }
  } else if (pathArray.size == 2) {
    val previousId = (pathArray[0] / 2) * 2
    val nextId = (pathArray[1] / 2) * 2
    val previous = pathPolylines[previousId]!!
    val next = pathPolylines[nextId]!!
    val forwardIsNextForwardAligned = checkAligned(previous, false, next, false)
    val forwardIsNextReverseAligned = checkAligned(previous, false, next, true)
    if (forwardIsNextForwardAligned || forwardIsNextReverseAligned) {
      orientedPathIds.put(0, previousId)
      if (forwardIsNextForwardAligned) {
        orientedPathIds.put(1, nextId)
      } else {
        orientedPathIds.put(1, nextId + 1)
      }
    } else {
      orientedPathIds.put(0, previousId + 1)
      if (checkAligned(previous, true, next, false)) {
        orientedPathIds.put(1, nextId)
      } else {
        orientedPathIds.put(1, nextId + 1)
      }
    }
  } else {
    orientedPathIds.put(0, pathArray[0])
  }

  if (!globallyAligned) {
    globallyAlign(orientedPathIds, pathPolylines)
  }

  orientedPathIdBytes.rewind()
  return orientedPathIdBytes
}

private fun checkAligned(
    firstVertices: DoubleBuffer,
    firstReversed: Boolean,
    secondVertices: DoubleBuffer,
    secondReversed: Boolean,
): Boolean {
  val firstLast =
    if (firstReversed) {
      Pair(firstVertices.get(0), firstVertices.get(1))
    } else {
      Pair(
          firstVertices.get(firstVertices.capacity() - 2),
          firstVertices.get(firstVertices.capacity() - 1))
    }
  val secondFirst =
    if (secondReversed) {
      Pair(
          secondVertices.get(secondVertices.capacity() - 2),
          secondVertices.get(secondVertices.capacity() - 1))
    } else {
      Pair(secondVertices.get(0), secondVertices.get(1))
    }
  return firstLast == secondFirst
}

private fun globallyAlign(orientedPathIds: LongBuffer, pathPolylines: Map<Long, DoubleBuffer>) {
  val starts = ImmutableMultimap.Builder<Pair<Double, Double>, Long>()
  val uses = HashMap<Long, Int>()
  for (i in 0 until orientedPathIds.capacity()) {
    val id = orientedPathIds[i]
    val forward = id and 1L.inv()
    uses[forward] = (uses[forward] ?: 0) + 1
    val polyline = pathPolylines[forward]!!
    starts.put(Pair(polyline[0], polyline[1]), forward)
    starts.put(Pair(polyline[polyline.capacity() - 2], polyline[polyline.capacity() - 1]), id or 1L)
  }

  val builtStarts = starts.build()
  val firstGuess = orientedPathIds[0]
  if (maybeTracePath(firstGuess, orientedPathIds, builtStarts, uses, pathPolylines) ||
      maybeTracePath(firstGuess xor 1L, orientedPathIds, builtStarts, uses, pathPolylines)) {
    return
  }

  for (start in builtStarts.keys()) {
    if (builtStarts[start].size > 1) {
      continue
    }
    if (
        maybeTracePath(
            builtStarts[start].iterator().next(),
            orientedPathIds,
            builtStarts,
            uses,
            pathPolylines)) {
      return
    }
  }
}

fun maybeTracePath(
    start: Long,
    orientedPathIds: LongBuffer,
    starts: ImmutableMultimap<Pair<Double, Double>, Long>,
    uses: Map<Long, Int>,
    pathPolylines: Map<Long, DoubleBuffer>): Boolean {
  val stack = Stack<Pair<Long, Int>>()
  val trail = ArrayList<Long>()
  stack.push(Pair(start, 1))
  var success = false
  while (!stack.isEmpty()) {
    val (cursor, depth) = stack.pop()
    trail.add(cursor)
    if (depth == orientedPathIds.capacity()) {
      success = true
      break
    }

    while (trail.size > depth) {
      trail.removeLast()
    }

    val polyline = pathPolylines[cursor and 1L.inv()]!!
    val end = if ((cursor and 1L) == 0L) {
      Pair(polyline[polyline.capacity() - 2], polyline[polyline.capacity() - 1])
    } else {
      Pair(polyline[0], polyline[1])
    }
    for (candidate in starts[end]) {
      val forward = candidate and 1L.inv()
      if (trail.count { stop -> forward == (stop and 1L.inv()) } < uses[forward] ?: 0) {
        stack.push(Pair(candidate, depth + 1))
      }
    }
  }

  return if (success) {
    for (i in 0 until orientedPathIds.capacity()) {
      orientedPathIds.put(i, trail[i])
    }
    true
  } else {
    false
  }
}

private fun flattenNodesInto(geometry: RelationGeometry, out: MutableList<Long>) {
  for (member in geometry.membersList) {
    if (member.hasNodeId()) {
      // TODO(april): we never set this when importing data so...?
    } else if (member.hasRelation()) {
      flattenNodesInto(member.relation, out)
    } else if (member.hasWay()) {
      out.addAll(member.way.nodeIdsList)
    }
  }
}

private fun geometryToPolygon(
    geometry: RelationGeometry, nodePositions: Map<Long, NodeRecord>): S2Polygon {
  val polygon = S2PolygonBuilder(Options.UNDIRECTED_XOR)
  for (member in geometry.membersList) {
    val multiplier = when (member.function) {
      INNER -> -1
      OUTER -> 1
      else -> throw AssertionError("Bad function")
    }

    if (member.hasRelation()) {
      val child = geometryToPolygon(member.relation, nodePositions)
      child.loops.forEach {
        addLoopWithSign(it.vertices(), multiplier, polygon)
      }
    } else if (member.hasWay()) {
      val points = ArrayList<S2Point>()
      member.way.nodeIdsList.forEach {
        val position = nodePositions[it]!!
        points.add(S2LatLng.fromDegrees(position.lat, position.lng).toPoint())
      }
      for ((a, b) in points.windowed(2)) {
        polygon.addEdge(a, b)
      }
    }
  }

  return polygon.assemblePolygon()
}

private fun addLoopWithSign(points: List<S2Point>, sign: Int, polygon: S2PolygonBuilder) {
  // TODO: check sign?
  for (i in 0 until points.size - 1) {
    polygon.addEdge(points[i], points[i + 1])
  }
}