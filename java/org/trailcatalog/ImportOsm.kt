package org.trailcatalog

import com.google.devtools.build.runfiles.Runfiles
import crosby.binary.Osmformat.Relation.MemberType
import org.postgresql.copy.CopyManager
import org.postgresql.core.BaseConnection
import org.trailcatalog.pbf.NodesCsvInputStream
import org.trailcatalog.pbf.PbfBlockReader
import org.trailcatalog.pbf.RelationsCsvInputStream
import org.trailcatalog.pbf.RelationsMembersCsvInputStream
import org.trailcatalog.pbf.WaysCsvInputStream
import org.trailcatalog.pbf.WaysMembersCsvInputStream
import java.io.FileInputStream
import java.sql.Connection
import java.sql.DriverManager

fun main(args: Array<String>) {
  val connection =
      DriverManager.getConnection(
          "jdbc:postgresql://10.110.231.203:5432/trailcatalog?currentSchema=public",
          "postgres",
          "postgres")
  importOsmFromPbf(connection)
}

fun importOsmFromPbf(connection: Connection) {
  if (!(connection is BaseConnection)) {
    throw RuntimeException("Connection is not a Postgres BaseConnection")
  }

  val reader = PbfBlockReader(
      FileInputStream(
          Runfiles.create().rlocation("trailcatalog/java/org/trailcatalog/washington-latest.osm.pbf")))
  val copier = CopyManager(connection)

  for (block in reader.readBlocks()) {
    copier.copyIn("COPY nodes FROM STDIN WITH CSV HEADER", NodesCsvInputStream(block))
    copier.copyIn("COPY ways FROM STDIN WITH CSV HEADER", WaysCsvInputStream(block))
    copier.copyIn("COPY relations FROM STDIN WITH CSV HEADER", RelationsCsvInputStream(block))
    copier.copyIn("COPY nodes_in_ways FROM STDIN WITH CSV HEADER", WaysMembersCsvInputStream(block))
    copier.copyIn(
        "COPY relations_in_relations FROM STDIN WITH CSV HEADER",
        RelationsMembersCsvInputStream("parent_id", "child_id", MemberType.RELATION, block))
    copier.copyIn(
        "COPY ways_in_relations FROM STDIN WITH CSV HEADER",
        RelationsMembersCsvInputStream("relation_id", "way_id", MemberType.WAY, block))
  }
}
