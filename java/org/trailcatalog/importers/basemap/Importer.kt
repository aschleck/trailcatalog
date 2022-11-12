package org.trailcatalog.importers.basemap

import com.zaxxer.hikari.HikariDataSource
import org.postgresql.copy.CopyManager
import org.postgresql.jdbc.PgConnection
import org.trailcatalog.createConnectionSource
import org.trailcatalog.importers.pipeline.groupBy
import org.trailcatalog.importers.pipeline.Pipeline
import org.trailcatalog.importers.pbf.ExtractNodeWayPairs
import org.trailcatalog.importers.pbf.ExtractNodes
import org.trailcatalog.importers.pbf.ExtractRelationGeometriesWithWays
import org.trailcatalog.importers.pbf.ExtractRelations
import org.trailcatalog.importers.pbf.ExtractWays
import org.trailcatalog.importers.pbf.GatherWayNodes
import org.trailcatalog.importers.pbf.ExtractWayRelationPairs
import org.trailcatalog.importers.pbf.GatherRelationWays
import org.trailcatalog.importers.pbf.MakeRelationGeometries
import org.trailcatalog.importers.pbf.MakeWayGeometries
import org.trailcatalog.importers.pbf.PbfBlockReader
import java.io.InputStream
import java.nio.file.Path

fun main(args: Array<String>) {
  createConnectionSource(syncCommit = false).use { hikari ->
    processPbfs(processArgsAndGetPbfs(args.asList()), hikari)
  }
}

private fun processPbfs(input: Pair<Int, List<Path>>, hikari: HikariDataSource) {
  val (epoch, pbfs) = input

  val pipeline = Pipeline()
  val nodes =
      pipeline.cat(
          pbfs.map { p ->
            pipeline
                .read(PbfBlockReader(p, readNodes = true, readRelations = false, readWays = false))
                .then(ExtractNodes())
          })
      .groupBy("GroupNodes") { it.id }
  val ways =
      pipeline.cat(
          pbfs.map { p ->
            pipeline
                .read(PbfBlockReader(p, readNodes = false, readRelations = false, readWays = true))
                .then(ExtractWays())
          })
      .groupBy("GroupWays") { it.id }
  val waysToPoints =
      pipeline
          .join2("JoinNodesForWayPoints", nodes, ways.then(ExtractNodeWayPairs()))
          .then(GatherWayNodes())
  val waysWithGeometry =
      pipeline
          .join2("JoinWaysForGeometry", ways, waysToPoints)
          .then(MakeWayGeometries())
  waysWithGeometry.write(DumpPaths(epoch, hikari))
  val relations =
      pipeline.cat(
          pbfs.map { p ->
            pipeline
                .read(PbfBlockReader(p, readNodes = false, readRelations = true, readWays = false))
                .then(ExtractRelations())
          })
          .groupBy("GroupRelations") { it.id }
  val relationsToGeometriesWithWays = relations.then(ExtractRelationGeometriesWithWays())
  val relationsToWayGeometries =
      pipeline
          .join2(
              "JoinOnWaysForRelationGeomeries",
              relationsToGeometriesWithWays.then(ExtractWayRelationPairs()),
              waysWithGeometry)
          .then(GatherRelationWays())
  val relationsGeometryById =
      pipeline
          .join2(
              "JoinRelationsForGeometry", relationsToGeometriesWithWays, relationsToWayGeometries)
          .then(MakeRelationGeometries())
  val relationsWithGeometry =
      pipeline.join2("JoinRelationsWithGeometry", relations, relationsGeometryById)
  val boundaries = relationsWithGeometry.then(CreateBoundaries())
  boundaries.write(DumpBoundaries(epoch, hikari))
  val trails = relationsWithGeometry.then(CreateTrails())
  trails.write(DumpPathsInTrails(epoch, hikari))
  trails.write(DumpTrails(epoch, hikari))
  val byCells = pipeline
      .join2(
          "JoinOnContainment",
          boundaries.then(GroupBoundariesByCell()),
          trails.then(GroupTrailsByCell()))
  byCells.then(CreateBoundariesInBoundaries()).write(DumpBoundariesInBoundaries(epoch, hikari))
  byCells.then(CreateTrailsInBoundaries()).write(DumpTrailsInBoundaries(epoch, hikari))

  pipeline.execute()

  hikari.connection.use {
    println("Updating epoch")
    it.prepareStatement("INSERT INTO active_epoch (epoch) VALUES (?)").apply {
      setInt(1, epoch)
    }.execute()
    println("Cleaning up old epochs")
    for (table in listOf(
        "active_epoch",
        "boundaries",
        "boundaries_in_boundaries",
        "path_elevations",
        "paths",
        "paths_in_trails",
        "trails",
        "trails_in_boundaries",
    )) {
      it.prepareStatement("DELETE FROM ${table} WHERE epoch < ?").apply {
        setInt(1, epoch)
      }.execute()
    }
  }
}

fun copyStreamToPg(table: String, stream: InputStream, hikari: HikariDataSource) {
  hikari.connection.use { connection ->
    val pg = connection.unwrap(PgConnection::class.java)
    CopyManager(pg).copyIn("COPY ${table} FROM STDIN WITH CSV HEADER", stream)
  }
}
