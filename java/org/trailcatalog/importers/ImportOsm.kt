package org.trailcatalog

import com.google.common.collect.ImmutableList
import crosby.binary.Osmformat.Relation.MemberType.RELATION
import crosby.binary.Osmformat.Relation.MemberType.WAY
import org.postgresql.copy.CopyManager
import org.postgresql.jdbc.PgConnection
import org.trailcatalog.importers.blockedOperation
import org.trailcatalog.pbf.NodesCsvInputStream
import org.trailcatalog.pbf.RelationsCsvInputStream
import org.trailcatalog.pbf.RelationsMembersCsvInputStream
import org.trailcatalog.pbf.WaysCsvInputStream
import org.trailcatalog.pbf.WaysMembersCsvInputStream

fun main(args: Array<String>) {
  createConnectionSource().connection.use {
    it.autoCommit = false
    it.createStatement().execute("SET SESSION synchronous_commit TO OFF")
    importOsmFromPbf(it.unwrap(PgConnection::class.java), args[0])
  }
}

fun importOsmFromPbf(connection: PgConnection, pbf: String) {
  val copier = CopyManager(connection)

  blockedOperation("copying nodes", pbf, ImmutableList.of("nodes"), connection) {
    copier.copyIn("COPY tmp_nodes FROM STDIN WITH CSV HEADER", NodesCsvInputStream(it))
  }

  blockedOperation("copying ways", pbf, ImmutableList.of("ways"), connection) {
    copier.copyIn("COPY tmp_ways FROM STDIN WITH CSV HEADER", WaysCsvInputStream(it))
  }

  blockedOperation("copying nodes_in_ways", pbf, ImmutableList.of("nodes_in_ways"), connection) {
    copier.copyIn(
        "COPY tmp_nodes_in_ways FROM STDIN WITH CSV HEADER", WaysMembersCsvInputStream(it))
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
