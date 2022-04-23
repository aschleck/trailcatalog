package org.trailcatalog.importers

import com.google.common.collect.ImmutableList
import crosby.binary.Osmformat.PrimitiveBlock
import crosby.binary.Osmformat.PrimitiveGroup
import crosby.binary.Osmformat.Relation.MemberType.RELATION
import crosby.binary.Osmformat.Relation.MemberType.WAY
import crosby.binary.Osmformat.Way
import org.postgresql.copy.CopyManager
import org.postgresql.jdbc.PgConnection
import org.trailcatalog.pbf.NodesCsvInputStream
import org.trailcatalog.pbf.RelationsCsvInputStream
import org.trailcatalog.pbf.RelationsMembersCsvInputStream
import org.trailcatalog.pbf.WaysCsvInputStream
import org.trailcatalog.pbf.WaysMembersCsvInputStream

fun importOsmFromPbf(connection: PgConnection, pbf: String) {
  val copier = CopyManager(connection)

  blockedOperation("copying nodes", pbf, ImmutableList.of("nodes"), connection) {
    copier.copyIn("COPY tmp_nodes FROM STDIN WITH CSV HEADER", NodesCsvInputStream(it))
  }

  blockedOperation("copying ways", pbf, ImmutableList.of("ways"), connection) {
    copier.copyIn("COPY tmp_ways FROM STDIN WITH CSV HEADER", WaysCsvInputStream(it))
  }

  val nodesInWays = ArrayList<Pair<Long, Way>>()
  blockedOperation("reading nodes_in_ways", pbf, ImmutableList.of(), connection) {
    for (group in it.primitivegroupList) {
      for (way in group.waysList) {
        nodesInWays.add(Pair(way.id, way))
      }
    }
  }
  nodesInWays.sortBy { it.first }
  val chunkSize = 100000
  ProgressBar("inserting nodes_in_ways", "chunks", (nodesInWays.size / chunkSize).toLong()).use {
    for (ways in nodesInWays.map { it.second }.chunked(chunkSize)) {
      val block = PrimitiveBlock.newBuilder()
      block.addPrimitivegroup(PrimitiveGroup.newBuilder().addAllWays(ways))
      withTempTables(ImmutableList.of("nodes_in_ways"), connection) {
        copier.copyIn(
            "COPY tmp_nodes_in_ways FROM STDIN WITH CSV HEADER",
            WaysMembersCsvInputStream(block.buildPartial()))
      }
      it.increment()
    }
  }

  blockedOperation(
      "copying remainder",
      pbf,
      ImmutableList.of("relations", "relations_in_relations", "ways_in_relations"),
      connection) {
    copier.copyIn("COPY tmp_relations FROM STDIN WITH CSV HEADER", RelationsCsvInputStream(it))
    copier.copyIn(
        "COPY tmp_relations_in_relations FROM STDIN WITH CSV HEADER",
        RelationsMembersCsvInputStream(RELATION, it))
    copier.copyIn(
        "COPY tmp_ways_in_relations FROM STDIN WITH CSV HEADER",
        RelationsMembersCsvInputStream(WAY, it))
  }
}
