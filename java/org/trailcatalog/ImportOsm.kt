package org.trailcatalog

import com.google.common.collect.ImmutableList
import crosby.binary.Osmformat.Relation.MemberType
import org.postgresql.copy.CopyManager
import org.postgresql.jdbc.PgConnection
import org.trailcatalog.pbf.NodesCsvInputStream
import org.trailcatalog.pbf.PbfBlockReader
import org.trailcatalog.pbf.RelationsCsvInputStream
import org.trailcatalog.pbf.RelationsMembersCsvInputStream
import org.trailcatalog.pbf.WaysCsvInputStream
import org.trailcatalog.pbf.WaysMembersCsvInputStream
import java.io.FileInputStream

fun main(args: Array<String>) {
  createConnectionSource().connection.use {
    it.autoCommit = false
    importOsmFromPbf(it.unwrap(PgConnection::class.java), args[0])
  }
}

fun importOsmFromPbf(connection: PgConnection, pbf: String) {
  val copier = CopyManager(connection)

  withTempTables(ImmutableList.of("nodes"), connection) {
    FileInputStream(pbf).use {
      for (block in PbfBlockReader(it).readBlocks()) {
        copier.copyIn("COPY tmp_nodes FROM STDIN WITH CSV HEADER", NodesCsvInputStream(block))
      }
    }
  }

  println("Copied nodes")

  withTempTables(ImmutableList.of("ways"), connection) {
    FileInputStream(pbf).use {
      for (block in PbfBlockReader(it).readBlocks()) {
        copier.copyIn("COPY tmp_ways FROM STDIN WITH CSV HEADER", WaysCsvInputStream(block))
      }
    }
  }

  println("Copied ways")

  withTempTables(ImmutableList.of("nodes_in_ways"), connection) {
    FileInputStream(pbf).use {
      for (block in PbfBlockReader(it).readBlocks()) {
        copier.copyIn(
            "COPY tmp_nodes_in_ways FROM STDIN WITH CSV HEADER", WaysMembersCsvInputStream(block)
        )
      }
    }
  }

  println("Copied nodes_in_ways")

  withTempTables(
      ImmutableList.of("relations", "relations_in_relations", "ways_in_relations"), connection) {
    FileInputStream(pbf).use {
      for (block in PbfBlockReader(it).readBlocks()) {
        copier.copyIn(
            "COPY tmp_relations FROM STDIN WITH CSV HEADER",
            RelationsCsvInputStream(block)
        )
        copier.copyIn(
            "COPY tmp_relations_in_relations FROM STDIN WITH CSV HEADER",
            RelationsMembersCsvInputStream(MemberType.RELATION, block)
        )
        copier.copyIn(
            "COPY tmp_ways_in_relations FROM STDIN WITH CSV HEADER",
            RelationsMembersCsvInputStream(MemberType.WAY, block)
        )
      }
    }
  }

  println("Copied relations, relations_in_relations, and ways_in_relations")
}
