package org.trailcatalog.importers.basemap

import com.google.common.geometry.S2CellId
import com.google.common.reflect.TypeToken
import com.zaxxer.hikari.HikariDataSource
import org.postgresql.copy.CopyManager
import org.postgresql.jdbc.PgConnection
import org.trailcatalog.createConnectionSource
import org.trailcatalog.importers.pipeline.groupBy
import org.trailcatalog.importers.pipeline.Pipeline
import org.trailcatalog.importers.pbf.ExtractNodeWayPairs
import org.trailcatalog.importers.pbf.ExtractNodes
import org.trailcatalog.importers.pbf.ExtractPoints
import org.trailcatalog.importers.pbf.ExtractRelationGeometriesWithWays
import org.trailcatalog.importers.pbf.ExtractRelations
import org.trailcatalog.importers.pbf.ExtractWays
import org.trailcatalog.importers.pbf.GatherWayNodes
import org.trailcatalog.importers.pbf.ExtractWayRelationPairs
import org.trailcatalog.importers.pbf.GatherRelationWays
import org.trailcatalog.importers.pbf.MakeRelationGeometries
import org.trailcatalog.importers.pbf.MakeWayGeometries
import org.trailcatalog.importers.pbf.PbfBlockReader
import org.trailcatalog.importers.pbf.Way
import org.trailcatalog.importers.pipeline.BoundStage
import org.trailcatalog.importers.pipeline.PMapTransformer
import org.trailcatalog.importers.pipeline.PTransformer
import org.trailcatalog.importers.pipeline.binaryStructListReader
import org.trailcatalog.importers.pipeline.binaryStructListWriter
import org.trailcatalog.importers.pipeline.collections.Emitter
import org.trailcatalog.importers.pipeline.collections.Emitter2
import org.trailcatalog.importers.pipeline.collections.PEntry
import org.trailcatalog.importers.pipeline.collections.PMap
import org.trailcatalog.importers.pipeline.invert
import org.trailcatalog.importers.pipeline.uniqueValues
import java.io.InputStream
import java.nio.file.Path

fun main(args: Array<String>) {
  createConnectionSource(syncCommit = false).use { hikari ->
    processPbfs(processArgsAndGetPbfs(args.asList()), hikari)
  }
}

private fun processPbfs(input: Pair<Int, List<Path>>, hikari: HikariDataSource) {
  val (epoch, pbfs) = input

  // TODO(april): it's good for speed to only calculate paths used in relations, but it means that
  // we won't be able to dynamically create trails. So need to relax this in the future.

  val pipeline = Pipeline()

  // First, get basic way geometries
  val nodeBlocks =
      pipeline.cat(
          pbfs.map { p ->
            pipeline
                .read(PbfBlockReader(p, readNodes = true, readRelations = false, readWays = false))
          });
  nodeBlocks.then(ExtractPoints()).write(DumpPoints(epoch, hikari))
  val nodes = nodeBlocks.then(ExtractNodes()).groupBy("GroupNodes") { it.id }
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

  // Now, take the way geometries, filter it down to ways in likely trail relations, and calculate
  // the required elevation profiles.
  val relations =
      pipeline.cat(
          pbfs.map { p ->
            pipeline
                .read(PbfBlockReader(p, readNodes = false, readRelations = true, readWays = false))
                .then(ExtractRelations())
          })
          .groupBy("GroupRelations") { it.id }
  val relationsToGeometriesWithWays = relations.then(ExtractRelationGeometriesWithWays())
  val waysInTrailRelations =
      pipeline.join2("JoinOnRelation", relations, relationsToGeometriesWithWays)
          .then(ExtractWaysFromTrailRelations())
  val waysNeedingElevations =
      pipeline.join2("JoinForWaysNeedingElevations", waysWithGeometry, waysInTrailRelations)
          .then(InnerJoinWays())
  val waysToElevations = calculateProfiles(hikari, pipeline, waysNeedingElevations)

  // Merge the way geometry and way elevations
  val waysWithElevationAndGeometry =
      pipeline
        .join2("JoinWaysForElevation", waysWithGeometry, waysToElevations)
        .then(UpdateWayElevations())

  // Dump the paths
  waysWithElevationAndGeometry.write(DumpPaths(epoch, hikari))
  waysToElevations.write(DumpPathElevations(epoch, hikari))

  // Now start resolving all of the relations' geometry
  val relationsToWayGeometries =
      pipeline
          .join2(
              "JoinOnWaysForRelationGeomeries",
              relationsToGeometriesWithWays.then(ExtractWayRelationPairs()),
              waysWithElevationAndGeometry)
          .then(GatherRelationWays())
  val relationsGeometryById =
      pipeline
          .join2(
              "JoinRelationsForGeometry", relationsToGeometriesWithWays, relationsToWayGeometries)
          .then(MakeRelationGeometries())
  val relationsWithGeometry =
      pipeline.join2("JoinRelationsWithGeometry", relations, relationsGeometryById)

  // Now start dumping boundaries, trails, and what contains what.
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
  val trailsInBoundaries = byCells.then(CreateTrailsInBoundaries()).uniqueValues("UniqueBoundaries")
  val trailIdToContainingBoundaries =
      pipeline
          .join2(
              "JoinOnBoundary",
              boundaries.groupBy("GroupById") { it.id },
              trailsInBoundaries.invert("InvertMap"))
          .then(GatherTrailBoundaries())
  pipeline
      .join2(
          "JoinOnTrail",
          trails.groupBy("GroupById") { it.relationId },
          trailIdToContainingBoundaries)
      .then(CreateReadableTrailIds())
      .then(DisambiguateTrailIds())
      .write(DumpReadableTrailIds(epoch, hikari))
  trailsInBoundaries.write(DumpTrailsInBoundaries(epoch, hikari))

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
        "boundary_identifiers",
        "path_elevations",
        "paths",
        "paths_in_trails",
        "trail_identifiers",
        "trails",
        "trails_in_boundaries",
    )) {
      it.prepareStatement("DELETE FROM ${table} WHERE epoch < ?").apply {
        setInt(1, epoch)
      }.execute()
    }
  }
}

private fun calculateProfiles(
    hikari: HikariDataSource,
    pipeline: Pipeline,
    waysNeedingProfiles: BoundStage<*, PMap<Long, Way>>,
): BoundStage<*, PMap<Long, Profile>> {
  ELEVATION_PROFILES_FILE.createNewFile()
  val existingProfiles =
      pipeline.read(binaryStructListReader<Profile>(ELEVATION_PROFILES_FILE))
          .groupBy("GroupProfiles") { it.id }

  val waysSources = pipeline.join2("JoinExistingProfiles", waysNeedingProfiles, existingProfiles)
  val alreadyHadProfiles =
      waysSources
          .then(
              object : PTransformer<PEntry<Long, Pair<List<Way>, List<Profile>>>, Profile>(
                  TypeToken.of(Profile::class.java)) {
                override fun act(
                    input: PEntry<Long, Pair<List<Way>, List<Profile>>>,
                    emitter: Emitter<Profile>) {
                  for (value in input.values) {
                    if (value.first.isEmpty()) {
                      continue
                    }

                    val hash = value.first[0].hash
                    val hasHash = value.second.any { it.hash == hash }
                    if (hasHash) {
                      emitter.emit(value.second[0])
                    }
                  }
                }
              })
  val missingWays =
      waysSources
          .then(
              object : PMapTransformer<PEntry<Long, Pair<List<Way>, List<Profile>>>, Long, Way>(
                  "FilterForMissingProfiles",
                  TypeToken.of(Long::class.java),
                  TypeToken.of(Way::class.java)) {
                override fun act(
                    input: PEntry<Long, Pair<List<Way>, List<Profile>>>,
                    emitter: Emitter2<Long, Way>) {
                  for (value in input.values) {
                    if (value.first.isEmpty()) {
                      continue
                    }

                    val hash = value.first[0].hash
                    val hasHash = value.second.any { it.hash == hash }
                    if (!hasHash) {
                      emitter.emit(input.key, value.first[0])
                    }
                  }
                }
              })
          .then(
              object : PTransformer<PEntry<Long, Way>, Way>(TypeToken.of(Way::class.java)) {
                override fun act(input: PEntry<Long, Way>, emitter: Emitter<Way>) {
                  emitter.emit(input.values[0])
                }
              })

  val waysByCells = missingWays.groupBy("GroupWaysMissingProfilesByCells") {
    // 1 degree on Earth is around 111km, which is in between the edge lengths of level 6 and 7. So
    // to balance between downloading Copernicus imagery multiple times (because level 6 cells are
    // contained by a Copernicus tile) and loading too many USGS 1m tiles at one time (because
    // they have 30x the density of a Copernicus tile in 5x the size), just pick 7.
    S2CellId.fromLatLng(it.points[0].toS2LatLng()).parent(7)
  }
  val calculatedProfiles = waysByCells.then(CalculateWayElevations(hikari))

  pipeline
      .cat(listOf(alreadyHadProfiles, calculatedProfiles))
      .write(binaryStructListWriter(ELEVATION_PROFILES_FILE))

  return pipeline
      .cat(listOf(alreadyHadProfiles, calculatedProfiles))
      .groupBy("GroupProfilesById") { it.id }
}

fun copyStreamToPg(table: String, stream: InputStream, hikari: HikariDataSource) {
  hikari.connection.use { connection ->
    val pg = connection.unwrap(PgConnection::class.java)
    CopyManager(pg).copyIn("COPY ${table} FROM STDIN WITH CSV HEADER", stream)
  }
}
