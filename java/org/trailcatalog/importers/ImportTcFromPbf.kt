package org.trailcatalog.importers

import com.google.common.collect.ImmutableList
import com.google.protobuf.ByteString
import crosby.binary.Osmformat.PrimitiveBlock
import crosby.binary.Osmformat.Relation.MemberType.NODE
import crosby.binary.Osmformat.Relation.MemberType.RELATION
import crosby.binary.Osmformat.Relation.MemberType.WAY
import org.postgresql.copy.CopyManager
import org.postgresql.jdbc.PgConnection
import org.trailcatalog.pbf.BoundariesCsvInputStream
import org.trailcatalog.pbf.NANO
import org.trailcatalog.pbf.PathsCsvInputStream
import org.trailcatalog.pbf.PathsInTrailsCsvInputStream
import org.trailcatalog.pbf.PbfBlockReader
import org.trailcatalog.pbf.TrailsCsvInputStream
import org.trailcatalog.pbf.relationToSkeleton
import org.trailcatalog.proto.RelationMemberFunction.INNER
import org.trailcatalog.proto.RelationMemberFunction.OUTER
import org.trailcatalog.proto.RelationSkeleton
import org.trailcatalog.proto.RelationSkeletonMember
import java.io.FileInputStream

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
      relations[relation.id] = relationToSkeleton(relation, block.stringtable)
    }
  }
}
