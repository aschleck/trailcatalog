package org.trailcatalog

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
    importOsmFromPbf(it.unwrap(PgConnection::class.java), args[0])
  }
}

fun importOsmFromPbf(connection: PgConnection, pbf: String) {
  for (table in listOf(
      "boundaries",
      "nodes",
      "nodes_in_ways",
      "paths",
      "paths_in_trails",
      "relations",
      "relations_in_relations",
      "trails",
      "ways",
      "ways_in_relations",
  )) {
    connection.createStatement().execute(
        "CREATE TEMP TABLE tmp_${table} (LIKE ${table} INCLUDING DEFAULTS)")
  }

  val copier = CopyManager(connection)

  FileInputStream(pbf).use {
    for (block in PbfBlockReader(it).readBlocks()) {
      copier.copyIn("COPY tmp_nodes FROM STDIN WITH CSV HEADER", NodesCsvInputStream(block))
    }
  }

  println("Copied nodes")

  FileInputStream(pbf).use {
    for (block in PbfBlockReader(it).readBlocks()) {
      copier.copyIn("COPY tmp_ways FROM STDIN WITH CSV HEADER", WaysCsvInputStream(block))
    }
  }

  println("Copied ways")

  FileInputStream(pbf).use {
    for (block in PbfBlockReader(it).readBlocks()) {
      copier.copyIn(
          "COPY tmp_nodes_in_ways FROM STDIN WITH CSV HEADER", WaysMembersCsvInputStream(block))
    }
  }

  println("Copied nodes_in_ways")

  FileInputStream(pbf).use {
    for (block in PbfBlockReader(it).readBlocks()) {
      copier.copyIn("COPY tmp_relations FROM STDIN WITH CSV HEADER", RelationsCsvInputStream(block))
      copier.copyIn(
          "COPY tmp_relations_in_relations FROM STDIN WITH CSV HEADER",
          RelationsMembersCsvInputStream(MemberType.RELATION, block))
      copier.copyIn(
          "COPY tmp_ways_in_relations FROM STDIN WITH CSV HEADER",
          RelationsMembersCsvInputStream(MemberType.WAY, block))
    }
  }

  println("Copied relations, relations_in_relations, and ways_in_relations")

  for (table in listOf(
      "boundaries",
      "nodes",
      "nodes_in_ways",
      "paths",
      "paths_in_trails",
      "relations",
      "relations_in_relations",
      "trails",
      "ways",
      "ways_in_relations",
  )) {
    connection.createStatement().execute(
        "INSERT INTO ${table} SELECT * FROM tmp_${table} ON CONFLICT DO NOTHING")
  }

  println("Copied temp tables")
}
