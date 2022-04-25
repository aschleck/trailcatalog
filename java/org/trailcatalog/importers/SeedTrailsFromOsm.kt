package org.trailcatalog.importers

import com.google.common.collect.ImmutableList
import com.google.common.geometry.S2LatLng
import com.google.common.geometry.S2LatLngRect
import com.google.common.geometry.S2Point
import com.google.common.geometry.S2Polygon
import com.google.common.geometry.S2PolygonBuilder
import com.google.common.geometry.S2Polyline
import com.google.protobuf.ByteString
import com.zaxxer.hikari.HikariDataSource
import crosby.binary.Osmformat.PrimitiveBlock
import crosby.binary.Osmformat.Relation.MemberType.NODE
import crosby.binary.Osmformat.Relation.MemberType.RELATION
import crosby.binary.Osmformat.Relation.MemberType.WAY
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.runBlocking
import org.postgresql.copy.CopyManager
import org.postgresql.jdbc.PgConnection
import org.trailcatalog.pbf.BoundariesCsvInputStream
import org.trailcatalog.pbf.NANO
import org.trailcatalog.pbf.PathsCsvInputStream
import org.trailcatalog.pbf.PathsInTrailsCsvInputStream
import org.trailcatalog.pbf.PbfBlockReader
import org.trailcatalog.pbf.TrailsCsvInputStream
import org.trailcatalog.proto.RelationGeometry
import org.trailcatalog.proto.RelationMemberFunction.INNER
import org.trailcatalog.proto.RelationMemberFunction.OUTER
import org.trailcatalog.proto.RelationSkeleton
import org.trailcatalog.proto.RelationSkeletonMember
import org.trailcatalog.s2.boundToCell
import org.trailcatalog.s2.earthMeters
import java.io.ByteArrayOutputStream
import java.io.FileInputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.DoubleBuffer
import java.sql.Connection

fun seedFromPbf(
    connection: PgConnection,
    immediatelyBucketPaths: Boolean,
    fillTcRelations: Boolean,
    pbf: String) {
  val reader = PbfBlockReader(FileInputStream(pbf))
  val nodes = HashMap<Long, Pair<Double, Double>>()
  val relations = HashMap<Long, RelationSkeleton>()

  ProgressBar("gathering nodes and relations", "blocks").use {
    for (block in reader.readBlocks()) {
      if (immediatelyBucketPaths) {
        gatherNodes(block, nodes)
      }
      if (fillTcRelations) {
        gatherRelationSkeletons(block, relations)
      }
      it.increment()
    }
  }

  val copier = CopyManager(connection)
  val ways = HashMap<Long, LongArray>()

  blockedOperation("copying paths", pbf, ImmutableList.of("paths"), connection) {
    copier.copyIn(
        "COPY tmp_paths FROM STDIN WITH CSV HEADER",
        PathsCsvInputStream(if (immediatelyBucketPaths) nodes else null, ways, it))
  }

  if (fillTcRelations) {
    blockedOperation("copying boundaries", pbf, ImmutableList.of("boundaries"), connection) {
      copier.copyIn(
          "COPY tmp_boundaries FROM STDIN WITH CSV HEADER",
          BoundariesCsvInputStream(relations, ways, it))
    }

    blockedOperation("copying trails", pbf, ImmutableList.of("trails"), connection) {
      copier.copyIn(
          "COPY tmp_trails FROM STDIN WITH CSV HEADER", TrailsCsvInputStream(relations, it))
    }

    blockedOperation(
        "copying paths_in_trails",
        pbf,
        ImmutableList.of("paths_in_trails"),
        connection) {
      copier.copyIn(
          "COPY tmp_paths_in_trails FROM STDIN WITH CSV HEADER",
          PathsInTrailsCsvInputStream(relations, it))
    }
  }
}

fun fillInGeometry(hikari: HikariDataSource) {
  hikari.connection.use {
    fillInBoundaries(it)
  }
  fillInPaths(hikari)
  hikari.connection.use {
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
      val nodePositions = HashMap<Long, Pair<Double, Double>>()
      while (nodeResults.next()) {
        nodePositions[nodeResults.getLong(1)] =
          Pair(nodeResults.getDouble(2), nodeResults.getDouble(3))
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

private fun fillInPaths(hikari: HikariDataSource) {
  val scope = CoroutineScope(Dispatchers.IO)

  ProgressBar("filling in paths", "paths").use { progress ->
    val batches = Channel<List<Pair<Long, ByteArray>>>(10)
    val fetchData = scope.async {
      hikari.connection.use { connection ->
        connection.autoCommit = false
        val getPaths =
          connection.prepareStatement(
              "SELECT id, node_ids FROM paths WHERE cell = -1 AND length(node_ids) > 0").also {
            it.fetchSize = 10000
          }

        val results = getPaths.executeQuery()

        if (!results.isBeforeFirst) {
          batches.close()
          connection.autoCommit = true
          return@async
        }

        while (!results.isAfterLast) {
          val start = System.currentTimeMillis()
          val batch = ArrayList<Pair<Long, ByteArray>>()
          var i = 0
          while (i < 1000 && results.next()) {
            val pathId = results.getLong(1)
            val nodeBytes = results.getBytes(2)
            batch.add(Pair(pathId, nodeBytes))
            i += 1
          }
          println("getting a batch took ${(System.currentTimeMillis() - start) / 1000.0}s")

          batches.send(batch)
        }
        batches.close()
        connection.autoCommit = true
      }
    }

    val workers = (0 until 4).map {
      scope.async {
        val toLookup = HashSet<Long>()
        val nodePositions = HashMap<Long, Pair<Double, Double>>()
        hikari.connection.use { connection ->
          connection.autoCommit = false

          val getNodes =
            connection.prepareStatement(
                "SELECT id, lat_degrees, lng_degrees FROM nodes WHERE id = ANY (?)").also {
              it.fetchSize = 20000
            }
          val updatePath =
            connection.prepareStatement("UPDATE paths SET cell = ?, lat_lng_degrees = ? WHERE id = ?")

          while (true) {
            val result = batches.receiveCatching()
            if (result.isClosed || result.isFailure) {
              break
            }

            val batch = result.getOrNull()!!
            toLookup.clear()
            nodePositions.clear()

            for ((_, nodeBytes) in batch) {
              val nodeIds = ByteBuffer.wrap(nodeBytes).order(ByteOrder.LITTLE_ENDIAN).asLongBuffer()
              while (nodeIds.hasRemaining()) {
                toLookup.add(nodeIds.get())
              }
            }

            val start = System.currentTimeMillis()
            getNodes.apply {
              setArray(1, connection.createArrayOf("bigint", toLookup.toArray()))
            }.executeQuery().use {
              while (it.next()) {
                nodePositions[it.getLong(1)] = Pair(it.getDouble(2), it.getDouble(3))
              }
            }
            println("fetching nodes took ${(System.currentTimeMillis() - start) / 1000.0}s")

            val startProcess = System.currentTimeMillis()
            for ((id, nodeBytes) in batch) {
              val nodes = ByteBuffer.wrap(nodeBytes).order(ByteOrder.LITTLE_ENDIAN).asLongBuffer()

              val latLngs = ByteBuffer.allocate(2 * nodeBytes.size).order(ByteOrder.LITTLE_ENDIAN)
              val bound = S2LatLngRect.empty().toBuilder()
              var valid = true
              while (nodes.hasRemaining()) {
                val nodeId = nodes.get()
                val position = nodePositions[nodeId]
                if (position == null) {
                  valid = false
                  break
                }

                latLngs.putDouble(position.first)
                latLngs.putDouble(position.second)
                bound.addPoint(S2LatLng.fromDegrees(position.first, position.second))
              }

              if (!valid) {
                continue
              }

              updatePath.apply {
                setLong(1, boundToCell(bound.build()).id())
                setBytes(2, latLngs.array())
                setLong(3, id)
                addBatch()
              }

              progress.increment()
            }

            updatePath.executeBatch()
            connection.commit()
            println("commit paths took ${(System.currentTimeMillis() - startProcess) / 1000.0}s")
          }

          connection.autoCommit = true
        }
      }
    }

    runBlocking {
      fetchData.await()
      workers.forEach { it.await() }
    }
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
    val pathPolylines = HashMap<Long, ByteArray>()

    while (!results.isAfterLast) {
      batch.clear()
      toLookup.clear()
      pathPolylines.clear()

      var i = 0
      while (i < 1000 && results.next()) {
        val trailId = results.getLong(1)
        val pathBytes = results.getBytes(2)

        val originalPathIds = ByteBuffer.wrap(pathBytes).order(ByteOrder.LITTLE_ENDIAN).asLongBuffer()
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
          pathPolylines[it.getLong(1)] = it.getBytes(2)
        }
      }

      runBlocking {
        batch.map { (id, pathBytes) ->
          scope.async {
            val paths = ByteBuffer.wrap(pathBytes).order(ByteOrder.LITTLE_ENDIAN).asLongBuffer()
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

            synchronized (updateTrail) {
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

      updateTrail.executeBatch()
    }
  }
}

private fun pathsToPolyline(
    orientedPathIdBytes: ByteBuffer,
    pathPolylines: HashMap<Long, ByteArray>): S2Polyline {
  val polyline = ArrayList<S2Point>()
  while (orientedPathIdBytes.hasRemaining()) {
    val pathId = orientedPathIdBytes.getLong()
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
  return s2Polyline
}

private fun orientPaths(
    pathArray: LongArray,
    pathPolylines: HashMap<Long, ByteArray>): ByteBuffer {
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

  orientedPathIdBytes.rewind()
  return orientedPathIdBytes
}

private val BS_INNER = ByteString.copyFromUtf8("inner")

private fun gatherNodes(
    block: PrimitiveBlock,
    nodes: HashMap<Long, Pair<Double, Double>>) {
  for (group in block.primitivegroupList) {
    for (node in group.nodesList) {
      val latDegrees = (block.latOffset + block.granularity * node.lat) * NANO
      val lngDegrees = (block.lonOffset + block.granularity * node.lon) * NANO
      nodes[node.id] = Pair(latDegrees, lngDegrees)
    }

    var denseId = 0L
    var denseLat = 0L
    var denseLon = 0L
    for (index in 0 until group.dense.idCount) {
      denseId += group.dense.idList[index]
      denseLat += group.dense.latList[index]
      denseLon += group.dense.lonList[index]

      val latDegrees = (block.latOffset + block.granularity * denseLat) * org.trailcatalog.pbf.NANO
      val lngDegrees = (block.lonOffset + block.granularity * denseLon) * org.trailcatalog.pbf.NANO
      nodes[denseId] = Pair(latDegrees, lngDegrees)
    }
  }
}

private fun gatherRelationSkeletons(
    block: PrimitiveBlock,
    relations: HashMap<Long, RelationSkeleton>) {
  for (group in block.primitivegroupList) {
    for (relation in group.relationsList) {
      var memberId = 0L
      val skeleton = RelationSkeleton.newBuilder()
      for (i in 0 until relation.memidsCount) {
        memberId += relation.getMemids(i)
        val inner = block.stringtable.getS(relation.getRolesSid(i)) == BS_INNER

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
      relations[relation.id] = skeleton.build()
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

fun flattenNodesInto(geometry: RelationGeometry, out: MutableList<Long>) {
  for (member in geometry.membersList) {
    if (member.hasNodeId()) {
      out.add(member.nodeId)
    } else if (member.hasRelation()) {
      flattenNodesInto(member.relation, out)
    } else if (member.hasWay()) {
      out.addAll(member.way.nodeIdsList)
    }
  }
}

fun geometryToPolygon(
    geometry: RelationGeometry, nodePositions: Map<Long, Pair<Double, Double>>): S2Polygon {
  val polygon = S2PolygonBuilder(S2PolygonBuilder.Options.UNDIRECTED_XOR)
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
        points.add(S2LatLng.fromDegrees(position.first, position.second).toPoint())
      }
      addLoopWithSign(points, multiplier, polygon)
    }
  }

  return polygon.assemblePolygon()
}

fun addLoopWithSign(points: List<S2Point>, sign: Int, polygon: S2PolygonBuilder) {
  // TODO: check sign?
  for (i in 0 until points.size - 1) {
    polygon.addEdge(points[i], points[i + 1])
  }
}