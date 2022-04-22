package org.trailcatalog

import com.google.common.collect.ImmutableList
import com.google.common.geometry.S2LatLng
import com.google.common.geometry.S2LatLngRect
import com.google.common.geometry.S2Point
import com.google.common.geometry.S2Polyline
import crosby.binary.Osmformat.PrimitiveBlock
import org.postgresql.copy.CopyManager
import org.postgresql.jdbc.PgConnection
import org.trailcatalog.importers.ProgressBar
import org.trailcatalog.importers.blockedOperation
import org.trailcatalog.pbf.BoundariesCsvInputStream
import org.trailcatalog.pbf.PathsCsvInputStream
import org.trailcatalog.pbf.PathsInTrailsCsvInputStream
import org.trailcatalog.pbf.PbfBlockReader
import org.trailcatalog.pbf.TrailsCsvInputStream
import java.io.FileInputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.sql.Connection
import kotlin.collections.ArrayList
import kotlin.collections.HashMap
import org.trailcatalog.s2.boundToCell
import org.trailcatalog.s2.earthMeters
import java.nio.DoubleBuffer

fun main(args: Array<String>) {
  createConnectionSource().connection.use {
    val pg = it.unwrap(PgConnection::class.java)
    pg.createStatement().execute("SET SESSION synchronous_commit TO OFF")

    pg.autoCommit = false
    seedFromPbf(pg, args[0])

    pg.autoCommit = true
    fillInGeometry(pg)
  }
}

private fun seedFromPbf(connection: PgConnection, pbf: String) {
  val reader = PbfBlockReader(FileInputStream(pbf))
  val copier = CopyManager(connection)
  val nodes = HashSet<Long>()
  val relations = HashMap<Long, ByteArray>()
  val relationWays = HashMap<Long, ByteArray>()
  val ways = HashMap<Long, ByteArray>()

  for (block in reader.readBlocks()) {
    gatherNodes(block, nodes)
  }

  blockedOperation("copying paths", pbf, ImmutableList.of("paths"), connection) {
    copier.copyIn("COPY tmp_paths FROM STDIN WITH CSV HEADER", PathsCsvInputStream(ways, it))
  }

  blockedOperation("copying boundaries", pbf, ImmutableList.of("boundaries"), connection) {
    copier.copyIn(
        "COPY tmp_boundaries FROM STDIN WITH CSV HEADER",
        BoundariesCsvInputStream(nodes, relations, relationWays, ways, it))
  }

  blockedOperation("copying trails", pbf, ImmutableList.of("trails"), connection) {
    copier.copyIn(
        "COPY tmp_trails FROM STDIN WITH CSV HEADER", TrailsCsvInputStream(relationWays, it))
  }

  blockedOperation("copying paths_in_trails", pbf, ImmutableList.of("paths_in_trails"), connection) {
    copier.copyIn(
        "COPY tmp_paths_in_trails FROM STDIN WITH CSV HEADER",
        PathsInTrailsCsvInputStream(relationWays, it))
  }
}

private fun fillInGeometry(connection: Connection) {
  fillInBoundaries(connection)
  fillInPaths(connection)
  fillInTrails(connection)
}

private fun fillInBoundaries(connection: Connection) {
  val getBoundaries =
    connection.prepareStatement(
        "SELECT id, node_ids FROM boundaries WHERE cell = -1 AND length(node_ids) > 0"
    )
  val getNodes =
    connection.prepareStatement("SELECT id, lat_degrees, lng_degrees FROM nodes WHERE id = ANY (?)")
  val updateBoundary =
    connection.prepareStatement(
        "UPDATE boundaries SET cell = ?, lat_lng_degrees = ? WHERE id = ?"
    )

  val results = getBoundaries.executeQuery()

  ProgressBar("filling in boundaries", "boundaries").use { progress ->
    var batchSize = 0
    while (results.next()) {
      val boundaryId = results.getLong(1)
      val nodeBytes = results.getBytes(2)
      val nodeIds = ByteBuffer.wrap(nodeBytes).order(ByteOrder.LITTLE_ENDIAN).asLongBuffer()
      val nodeArray = arrayOfNulls<Long>(nodeBytes.size / 8)
      var nodeArrayI = 0
      while (nodeIds.hasRemaining()) {
        nodeArray[nodeArrayI] = nodeIds.get()
        nodeArrayI += 1
      }
      nodeIds.rewind()

      val nodeResults = getNodes.apply {
        setArray(1, connection.createArrayOf("bigint", nodeArray))
      }.executeQuery()
      val nodePositions = HashMap<Long, Pair<Double, Double>>()
      while (nodeResults.next()) {
        nodePositions[nodeResults.getLong(1)] =
          Pair(nodeResults.getDouble(2), nodeResults.getDouble(3))
      }

      val latLngs = ByteBuffer.allocate(2 * nodeBytes.size).order(ByteOrder.LITTLE_ENDIAN)
      val bound = S2LatLngRect.empty().toBuilder()
      while (nodeIds.hasRemaining()) {
        val nodeId = nodeIds.get()
        val position = nodePositions[nodeId]!!
        latLngs.putDouble(position.first)
        latLngs.putDouble(position.second)
        bound.addPoint(S2LatLng.fromDegrees(position.first, position.second))
      }

      updateBoundary.apply {
        setLong(1, boundToCell(bound.build()).id())
        setBytes(2, latLngs.array())
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

private fun fillInPaths(connection: Connection) {
  val getPaths =
    connection.prepareStatement(
        "SELECT id, node_ids FROM paths WHERE cell = -1 AND length(node_ids) > 0"
    )
  val getNodes =
    connection.prepareStatement("SELECT id, lat_degrees, lng_degrees FROM nodes WHERE id = ANY (?)")
  val updatePath =
    connection.prepareStatement(
        "UPDATE paths SET cell = ?, lat_lng_degrees = ? WHERE id = ?"
    )

  val results = getPaths.executeQuery()

  ProgressBar("filling in paths", "paths").use { progress ->
    var batchSize = 0
    while (results.next()) {
      val boundaryId = results.getLong(1)
      val nodeBytes = results.getBytes(2)
      val nodeIds = ByteBuffer.wrap(nodeBytes).order(ByteOrder.LITTLE_ENDIAN).asLongBuffer()
      val nodeArray = arrayOfNulls<Long>(nodeBytes.size / 8)
      var nodeArrayI = 0
      while (nodeIds.hasRemaining()) {
        nodeArray[nodeArrayI] = nodeIds.get()
        nodeArrayI += 1
      }
      nodeIds.rewind()

      val nodeResults = getNodes.apply {
        setArray(1, connection.createArrayOf("bigint", nodeArray))
      }.executeQuery()
      val nodePositions = HashMap<Long, Pair<Double, Double>>()
      while (nodeResults.next()) {
        nodePositions[nodeResults.getLong(1)] =
          Pair(nodeResults.getDouble(2), nodeResults.getDouble(3))
      }

      val latLngs = ByteBuffer.allocate(2 * nodeBytes.size).order(ByteOrder.LITTLE_ENDIAN)
      val bound = S2LatLngRect.empty().toBuilder()
      while (nodeIds.hasRemaining()) {
        val nodeId = nodeIds.get()
        val position = nodePositions[nodeId]!!
        latLngs.putDouble(position.first)
        latLngs.putDouble(position.second)
        bound.addPoint(S2LatLng.fromDegrees(position.first, position.second))
      }

      updatePath.apply {
        setLong(1, boundToCell(bound.build()).id())
        setBytes(2, latLngs.array())
        setLong(3, boundaryId)
        addBatch()
        batchSize += 1
        progress.increment()
      }

      if (batchSize >= 1000) {
        updatePath.executeBatch()
        batchSize = 0
      }
    }

    updatePath.executeBatch()
  }
}

private fun fillInTrails(connection: Connection) {
  val getTrails =
    connection.prepareStatement(
        "SELECT id, path_ids FROM trails WHERE cell = -1 AND length(path_ids) > 0"
    )
  val getPaths =
    connection.prepareStatement("SELECT id, lat_lng_degrees FROM paths WHERE id = ANY (?)")
  val updateTrail =
    connection.prepareStatement(
        "UPDATE trails SET cell = ?, center_lat_degrees = ?, center_lng_degrees = ?, "
                + "length_meters = ?, path_ids = ? WHERE id = ?"
    )

  val results = getTrails.executeQuery()

  ProgressBar("filling in trails", "trails").use { progress ->
    while (results.next()) {
      val trailId = results.getLong(1)
      val pathBytes = results.getBytes(2)
      val originalPathIds = ByteBuffer.wrap(pathBytes).order(ByteOrder.LITTLE_ENDIAN).asLongBuffer()
      val pathArray = ArrayList<Long>(pathBytes.size / 8)
      while (originalPathIds.hasRemaining()) {
        pathArray.add((originalPathIds.get() / 2) * 2) // make sure we get the forward direction
      }

      val pathResults = getPaths.apply {
        setArray(1, connection.createArrayOf("bigint", pathArray.toArray()))
      }.executeQuery()
      val pathPolylines = HashMap<Long, ByteArray>()
      while (pathResults.next()) {
        pathPolylines[pathResults.getLong(1)] = pathResults.getBytes(2)
      }
      val pathArrayIter = pathArray.iterator()
      var present = true
      while (pathArrayIter.hasNext()) {
        val pathId = pathArrayIter.next()

        if (!pathPolylines.containsKey(pathId)) {
//          println("Missing path ${pathId} from ${trailId}, skipping")
          present = false
          break
        }
      }

      if (!present || pathArray.size == 0) {
        continue
      }

      val orientedPathIdBytes =
          ByteBuffer.allocate(pathArray.size * 8).order(ByteOrder.LITTLE_ENDIAN)
      val orientedPathIds = orientedPathIdBytes.asLongBuffer()
      if (pathArray.size > 2) {
        for (i in 1 until pathArray.size - 1) {
          val previousId = (pathArray[i - 1] / 2) * 2
          val id = (pathArray[i] / 2) * 2
          val nextId = (pathArray[i + 1] / 2) * 2
          val previous =
              ByteBuffer.wrap(pathPolylines[previousId]!!)
                  .order(ByteOrder.LITTLE_ENDIAN)
                  .asDoubleBuffer()
          val current =
              ByteBuffer.wrap(pathPolylines[id]!!).order(ByteOrder.LITTLE_ENDIAN).asDoubleBuffer()
          val next =
            ByteBuffer.wrap(pathPolylines[nextId]!!).order(ByteOrder.LITTLE_ENDIAN).asDoubleBuffer()
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
              orientedPathIds.put(i - 1, previousId + 1)
            }
            orientedPathIds.put(i, id + 1)
            if (checkAligned(current, true, next, false)) {
              orientedPathIds.put(i + 1, nextId)
            } else {
              orientedPathIds.put(i + 1, nextId + 1)
            }
          }
        }
      } else if (pathArray.size == 2) {
        val previousId = (pathArray[0] / 2) * 2
        val nextId = (pathArray[1] / 2) * 2
        val previous =
            ByteBuffer.wrap(pathPolylines[previousId]!!)
                .order(ByteOrder.LITTLE_ENDIAN)
                .asDoubleBuffer()
        val next =
            ByteBuffer.wrap(pathPolylines[nextId]!!).order(ByteOrder.LITTLE_ENDIAN).asDoubleBuffer()
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

      val polyline = ArrayList<S2Point>()
      orientedPathIds.rewind()
      while (orientedPathIds.hasRemaining()) {
        val pathId = orientedPathIds.get()
        val path =
            ByteBuffer.wrap(pathPolylines[(pathId / 2) * 2]!!)
                .order(ByteOrder.LITTLE_ENDIAN)
                .asDoubleBuffer()
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

      val s2Polyline = S2Polyline(polyline)
      val center = S2LatLng(s2Polyline.interpolate(0.5))
      updateTrail.apply {
        setLong(1, boundToCell(s2Polyline.rectBound).id())
        setDouble(2, center.latDegrees())
        setDouble(3, center.lngDegrees())
        setDouble(4, s2Polyline.arclengthAngle.earthMeters())
        setBytes(5, orientedPathIdBytes.array())
        setLong(6, trailId)
        executeUpdate()
        progress.increment()
      }
    }
  }
}

fun gatherNodes(block: PrimitiveBlock, nodes: MutableSet<Long>) {
  for (group in block.primitivegroupList) {
    for (node in group.nodesList) {
      nodes.add(node.id)
    }

    var denseId = 0L
    for (index in 0 until group.dense.idCount) {
      denseId += group.dense.idList[index]
      nodes.add(denseId)
    }
  }
}

fun checkAligned(
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
