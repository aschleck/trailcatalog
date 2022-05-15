package org.trailcatalog.importers

import com.google.common.collect.ImmutableList
import com.google.common.geometry.S2LatLng
import com.google.common.geometry.S2LatLngRect
import com.google.protobuf.ByteString
import crosby.binary.Osmformat.PrimitiveBlock
import org.postgresql.copy.CopyManager
import org.postgresql.jdbc.PgConnection
import org.trailcatalog.models.WayCategory
import org.trailcatalog.pbf.BoundariesCsvInputStream
import org.trailcatalog.pbf.NANO
import org.trailcatalog.pbf.NodeRecord
import org.trailcatalog.pbf.PathsCsvInputStream
import org.trailcatalog.pbf.PathsInTrailsCsvInputStream
import org.trailcatalog.pbf.PbfBlockReader
import org.trailcatalog.pbf.TrailsCsvInputStream
import org.trailcatalog.pbf.relationToSkeleton
import java.io.FileInputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder

fun seedFromPbf(
    connection: PgConnection,
    immediatelyBucketPaths: Boolean,
    fillTcRelations: Boolean,
    pbf: String) {
  seedPaths(connection, immediatelyBucketPaths, pbf)

  val relations = HashMap<Long, ByteString>()
  val ways = HashMap<Long, LongArray>()
  ProgressBar("gathering relations and ways", "blocks").use {
    val reader = PbfBlockReader(FileInputStream(pbf))
    for (block in reader.readBlocks()) {
      if (fillTcRelations) {
        gatherRelationSkeletons(block, relations)
      }
      gatherWays(block, ways)
      it.increment()
    }
  }

  val copier = CopyManager(connection)
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

fun seedPaths(connection: PgConnection, immediatelyBucketPaths: Boolean, pbf: String) {
  val nodes = HashMap<Long, NodeRecord>()
  if (immediatelyBucketPaths) {
    ProgressBar("gathering nodes", "blocks").use {
      for (block in PbfBlockReader(FileInputStream(pbf)).readBlocks()) {
        gatherNodes(block, nodes)
        it.increment()
      }
    }
  }

  val copier = CopyManager(connection)
  blockedOperation("copying paths", pbf, ImmutableList.of("paths"), connection) {
    copier.copyIn(
        "COPY tmp_paths FROM STDIN WITH CSV HEADER",
        PathsCsvInputStream(if (immediatelyBucketPaths) nodes else null, it))
  }
}

private fun gatherNodes(
    block: PrimitiveBlock,
    nodes: HashMap<Long, NodeRecord>) {
  for (group in block.primitivegroupList) {
    for (node in group.nodesList) {
      val latDegrees = (block.latOffset + block.granularity * node.lat) * NANO
      val lngDegrees = (block.lonOffset + block.granularity * node.lon) * NANO
      nodes[node.id] = NodeRecord(latDegrees, lngDegrees)
    }

    var denseId = 0L
    var denseLat = 0L
    var denseLon = 0L
    for (index in 0 until group.dense.idCount) {
      denseId += group.dense.idList[index]
      denseLat += group.dense.latList[index]
      denseLon += group.dense.lonList[index]

      val latDegrees = (block.latOffset + block.granularity * denseLat) * NANO
      val lngDegrees = (block.lonOffset + block.granularity * denseLon) * NANO
      nodes[denseId] = NodeRecord(latDegrees, lngDegrees)
    }
  }
}

private fun gatherRelationSkeletons(block: PrimitiveBlock, relations: HashMap<Long, ByteString>) {
  for (group in block.primitivegroupList) {
    for (relation in group.relationsList) {
      relations[relation.id] = relationToSkeleton(relation, block.stringtable).toByteString()
    }
  }
}

private fun gatherWays(block: PrimitiveBlock, ways: HashMap<Long, LongArray>) {
  for (group in block.primitivegroupList) {
    for (way in group.waysList) {
      val nodes = LongArray(way.refsCount)
      val nodeBytes = ByteBuffer.allocate(way.refsCount * 8).order(ByteOrder.LITTLE_ENDIAN)
      var nodeId = 0L
      for (i in 0 until way.refsCount) {
        nodeId += way.getRefs(i)
        nodes[i] = nodeId
        nodeBytes.putLong(nodeId)
      }
      ways[way.id] = nodes
    }
  }
}
