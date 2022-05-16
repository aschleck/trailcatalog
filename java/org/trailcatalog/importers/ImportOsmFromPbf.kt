package org.trailcatalog.importers

import com.google.common.collect.ImmutableList
import crosby.binary.Osmformat.Relation.MemberType.RELATION
import crosby.binary.Osmformat.Relation.MemberType.WAY
import org.postgresql.copy.CopyManager
import org.postgresql.jdbc.PgConnection
import org.trailcatalog.pbf.IdPairRecord
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

  val nodesInWays = ArrayList<IdPairRecord>()
  blockedOperation("reading nodes_in_ways", pbf, ImmutableList.of(), connection) {
    for (group in it.primitivegroupList) {
      for (way in group.waysList) {
        var nodeId = 0L
        for (delta in way.refsList) {
          nodeId += delta
          nodesInWays.add(IdPairRecord(way.id, nodeId))
        }
      }
    }
  }
  nodesInWays.sortBy { it.a }
  val chunkSize = 10000
  ProgressBar(
      "inserting nodes_in_ways",
      "rows",
      nodesInWays.size.toLong()).use {
    for (chunk in nodesInWays.chunked(chunkSize)) {
      withTempTables(ImmutableList.of("nodes_in_ways"), connection) {
        copier.copyIn(
            "COPY tmp_nodes_in_ways FROM STDIN WITH CSV HEADER",
            WaysMembersCsvInputStream(chunk.chunked(256)))
      }
      it.incrementBy(chunk.size)
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
