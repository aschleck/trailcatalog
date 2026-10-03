package org.trailcatalog.importers.basemap

import com.google.common.geometry.S2CellId
import com.google.common.reflect.TypeToken
import com.zaxxer.hikari.HikariDataSource
import crosby.binary.Osmformat.PrimitiveBlock
import org.postgresql.copy.CopyManager
import org.postgresql.jdbc.PgConnection
import org.trailcatalog.createConnectionSource
import org.trailcatalog.flags.FlagSpec
import org.trailcatalog.flags.createFlag
import org.trailcatalog.flags.createNullableFlag
import org.trailcatalog.flags.parseFlags
import org.trailcatalog.importers.pipeline.groupBy
import org.trailcatalog.importers.pipeline.Pipeline
import org.trailcatalog.importers.pbf.ExtractNodeTags
import org.trailcatalog.importers.pbf.ExtractNodeWayPairs
import org.trailcatalog.importers.pbf.ExtractNodes
import org.trailcatalog.importers.pbf.ExtractPoints
import org.trailcatalog.importers.pbf.ExtractRelationGeometriesWithWays
import org.trailcatalog.importers.pbf.ExtractRelationTags
import org.trailcatalog.importers.pbf.ExtractRelations
import org.trailcatalog.importers.pbf.ExtractWayTags
import org.trailcatalog.importers.pbf.ExtractWays
import org.trailcatalog.importers.pbf.GatherWayNodes
import org.trailcatalog.importers.pbf.ExtractWayRelationPairs
import org.trailcatalog.importers.pbf.GatherRelationWays
import org.trailcatalog.importers.pbf.MakeRelationGeometries
import org.trailcatalog.importers.pbf.MakeWayGeometries
import org.trailcatalog.importers.pbf.MakeWayPoints
import org.trailcatalog.importers.pbf.PbfReader
import org.trailcatalog.importers.pbf.Way
import org.trailcatalog.importers.pipeline.BoundStage
import org.trailcatalog.importers.pipeline.PMapTransformer
import org.trailcatalog.importers.pipeline.PTransformer
import org.trailcatalog.importers.pipeline.binaryStructListReader
import org.trailcatalog.importers.pipeline.binaryStructListWriter
import org.trailcatalog.importers.pipeline.collections.Emitter
import org.trailcatalog.importers.pipeline.collections.Emitter2
import org.trailcatalog.importers.pipeline.collections.PCollection
import org.trailcatalog.importers.pipeline.collections.PEntry
import org.trailcatalog.importers.pipeline.collections.PMap
import org.trailcatalog.importers.pipeline.invert
import org.trailcatalog.models.RelationCategory
import java.io.File
import java.io.InputStream
import java.nio.file.Path
import java.sql.Connection
import java.time.LocalDateTime
import java.time.ZoneOffset
import java.util.concurrent.ConcurrentLinkedQueue

@FlagSpec(name = "elevation_profile")
private val elevationProfilePath = createNullableFlag(null as Path?)

// Picked by chooseEpoch unless given.
@FlagSpec(name = "epoch")
private val epochFlag = createNullableFlag(null as Int?)

@FlagSpec(name = "parallelism")
private val importerParallelism = createFlag((Runtime.getRuntime().availableProcessors() / 2).coerceAtLeast(1))

@FlagSpec(name = "pbfs")
private val pbfPaths = createFlag("")

// Tables partitioned by epoch. The partition holding epoch E is named ${table}_${E}.
private val PARTITIONED_TABLES =
    listOf(
        "boundaries",
        "boundaries_in_boundaries",
        "boundary_names",
        "path_elevations",
        "paths",
        "paths_in_trails",
        "point_names",
        "points",
        "points_in_boundaries",
        "source_tags",
        "trail_identifiers",
        "trail_names",
        "trails",
        "trails_in_boundaries",
    )

fun main(args: Array<String>) {
  parseFlags(args)
  registerBaseMapSerializers()

  val pbfs = pbfPaths.value.split(",").filter { it.isNotEmpty() }.map { Path.of(it) }
  createConnectionSource(syncCommit = false).use { hikari ->
    processPbfs(pbfs, hikari)
  }
}

private fun processPbfs(pbfs: List<Path>, hikari: HikariDataSource) {
  val activeEpochs = hikari.connection.use { readActiveEpochs(it) }
  val epoch = epochFlag.value ?: chooseEpoch(activeEpochs)
  println("Importing epoch ${epoch}")

  hikari.connection.use {
    // An import that dies partway never reaches the INSERT into active_epoch, so a cleanup driven
    // by active_epoch rows has nothing naming its partitions and leaves them attached with partial
    // rows in them forever. That includes this epoch, because a run killed by a signal commits
    // some of its COPYs and then a retry on the same day picks the same epoch and duplicates on
    // them. A live epoch is in activeEpochs, so it still survives.
    println("Dropping orphaned partitions")
    dropPartitionsExcept(it, activeEpochs)

    println("Creating partitions")
    for (table in PARTITIONED_TABLES) {
      it.prepareStatement(
              """
              CREATE TABLE IF NOT EXISTS ${table}_${epoch}
              PARTITION OF ${table} FOR VALUES IN (${epoch})
              """)
          .execute()
    }
  }

  // TODO(april): it's good for speed to only calculate paths used in relations, but it means that
  // we won't be able to dynamically create trails. So need to relax this in the future.

  val pipeline = Pipeline(parallelism = importerParallelism.value)
  println("Pipeline parallelism cap: ${importerParallelism.value}")

  // Every pass over the PBF is its own read. The first one learns which blobs hold which kind of
  // element, so the later ones skip what they don't want without inflating it. First, the elements
  // that need no geometry from anything else.
  pipeline
      .readPbfs(pbfs, nodes = true, extract = ExtractNodeTags())
      .write(DumpSourceTags(epoch, hikari))
  pipeline
      .readPbfs(pbfs, ways = true, extract = ExtractWayTags())
      .write(DumpSourceTags(epoch, hikari))
  pipeline
      .readPbfs(pbfs, relations = true, extract = ExtractRelationTags())
      .write(DumpSourceTags(epoch, hikari))

  // Then get basic way geometries. Relations come first because they decide which untagged ways
  // GroupWays keeps.
  val relations =
      pipeline
          .readPbfs(pbfs, relations = true, extract = ExtractRelations())
          .groupBy("GroupRelations") { it.id }
  val nodes =
      pipeline
          .readPbfs(pbfs, nodes = true, extract = ExtractNodes())
          .groupBy("GroupNodes") { it.id }
  val ways =
      pipeline.zip2(
          relations.then(CollectMemberWays()),
          pipeline.readPbfs(pbfs, ways = true, extract = ExtractWays()),
          GroupWays())
  val waysToPoints =
      pipeline
          .join2("JoinNodesForWayPoints", nodes, ways.then(ExtractNodeWayPairs()))
          .then(GatherWayNodes())
  val waysWithNodes = pipeline.join2("JoinWaysForGeometry", ways, waysToPoints)
  val waysWithGeometry = waysWithNodes.then(MakeWayGeometries())

  // Points come from nodes and from closed ways, like a campground drawn as its outline.
  val points =
      pipeline.cat(
          listOf(
              pipeline.readPbfs(pbfs, nodes = true, extract = ExtractPoints()),
              waysWithNodes.then(MakeWayPoints())))
  points.write(DumpPoints(epoch, hikari))
  points.write(DumpPointNames(epoch, hikari))

  // Now, take the way geometries, filter it down to ways in likely trail relations, and calculate
  // the required elevation profiles.
  val relationsToGeometriesWithWays = relations.then(ExtractRelationGeometriesWithWays())
  val waysInRouteRelations =
      pipeline.join2("JoinOnRelation", relations, relationsToGeometriesWithWays)
          .then(ExtractWaysFromFilteredRelations(RelationCategory.ROUTE))
  val waysNeedingElevations =
      pipeline.join2("JoinForWaysNeedingElevations", waysWithGeometry, waysInRouteRelations)
          .then(InnerJoinWays())
  val waysToElevations = calculateProfiles(pipeline, waysNeedingElevations)

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
              "JoinOnWaysForRelationGeometries",
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
  boundaries.write(DumpBoundaryNames(epoch, hikari))
  val trails = relationsWithGeometry.then(CreateTrails())
  trails.write(DumpPathsInTrails(epoch, hikari))
  trails.write(DumpTrails(epoch, hikari))
  trails.write(DumpTrailNames(epoch, hikari))
  val boundaryIndex = boundaries.then(BuildBoundaryIndex())
  boundaryIndex
      .then(FindBoundariesInBoundaries())
      .write(DumpBoundariesInBoundaries(epoch, hikari))
  pipeline
      .zip2(boundaryIndex, points, FindPointsInBoundaries())
      .write(DumpPointsInBoundaries(epoch, hikari))
  val trailsInBoundaries = pipeline.zip2(boundaryIndex, trails, FindTrailsInBoundaries())
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

  try {
    pipeline.execute()
  } catch (e: Throwable) {
    // Rerunning an epoch that is already live would drop the partitions the frontend is serving,
    // so only partitions this run created are safe to remove.
    if (!activeEpochs.contains(epoch)) {
      println("Dropping partitions for failed epoch ${epoch}")
      hikari.connection.use { dropPartitionsExcept(it, activeEpochs) }
    }
    throw e
  }

  hikari.connection.use {
    println("Updating epoch")
    it.prepareStatement(
        "INSERT INTO active_epoch (epoch) VALUES (?) ON CONFLICT DO NOTHING").apply {
      setInt(1, epoch)
    }.execute()

    println("Cleaning up old epochs")
    dropPartitionsExcept(it, setOf(epoch))

    println("Removing old epochs")
    it.prepareStatement("DELETE FROM active_epoch WHERE epoch < ?").apply {
      setInt(1, epoch)
    }.execute()
  }
}

private inline fun <reified T : Any> Pipeline.readPbfs(
    pbfs: List<Path>,
    nodes: Boolean = false,
    ways: Boolean = false,
    relations: Boolean = false,
    extract: PTransformer<PrimitiveBlock, T>): BoundStage<*, out PCollection<T>> {
  return cat(
      pbfs.map { p ->
        read(PbfReader(p, readNodes = nodes, readRelations = relations, readWays = ways, extract))
      })
}

private fun readActiveEpochs(connection: Connection): Set<Int> {
  val epochs = HashSet<Int>()
  connection.prepareStatement("SELECT epoch FROM active_epoch").executeQuery().use {
    while (it.next()) {
      epochs.add(it.getInt(1))
    }
  }
  return epochs
}

/** Drops every partition of [PARTITIONED_TABLES] whose epoch is not in [keep]. */
private fun dropPartitionsExcept(connection: Connection, keep: Set<Int>) {
  for (table in PARTITIONED_TABLES) {
    // Resolving the parent through regclass rather than by relname picks the same table the
    // CREATE TABLE above does, and gives back child names already qualified for the DROP.
    val partitions = ArrayList<Pair<Int, String>>()
    connection.prepareStatement(
        """
        SELECT c.relname, c.oid::regclass::text
        FROM pg_inherits i
        JOIN pg_class c ON c.oid = i.inhrelid
        WHERE i.inhparent = ?::regclass
        """).apply {
      setString(1, table)
    }.executeQuery().use { results ->
      while (results.next()) {
        val epoch = results.getString(1).removePrefix("${table}_").toIntOrNull() ?: continue
        partitions.add(Pair(epoch, results.getString(2)))
      }
    }

    // Collect before dropping because the DDL runs on the connection holding the result set.
    for ((partitionEpoch, qualified) in partitions) {
      if (keep.contains(partitionEpoch)) {
        continue
      }

      println("Dropping ${qualified}")
      connection.prepareStatement("DROP TABLE ${qualified}").execute()
    }
  }
}

private fun calculateProfiles(
    pipeline: Pipeline,
    waysNeedingProfiles: BoundStage<*, PMap<Long, Way>>,
): BoundStage<*, PMap<Long, Profile>> {
  val cachedProfiles = checkNotNull(elevationProfilePath.value).toFile()
  cachedProfiles.createNewFile()
  File(cachedProfiles.path + ".shards").createNewFile()
  val existingProfiles =
      pipeline.read(binaryStructListReader<Profile>(cachedProfiles))
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
    // A group is calculated back to back, so grouping by locality keeps its elevation tiles in the
    // resolver's cache. A level 7 cell is around 100km on a side, which is a few hundred z12 tiles
    // or a few thousand z14 ones.
    S2CellId.fromLatLng(it.points[0].toS2LatLng()).parent(7)
  }
  val calculatedProfiles = waysByCells.then(CalculateWayElevations())

  pipeline
      .cat(listOf(alreadyHadProfiles, calculatedProfiles))
      .write(binaryStructListWriter(cachedProfiles))

  return pipeline
      .cat(listOf(alreadyHadProfiles, calculatedProfiles))
      .groupBy("GroupProfilesById") { it.id }
}

fun copyStreamToPg(table: String, stream: InputStream, hikari: HikariDataSource) {
  hikari.connection.use { connection ->
    val pg = connection.unwrap(PgConnection::class.java)
    CopyManager(pg).copyIn("COPY ${table} FROM STDIN WITH (FORMAT CSV, HEADER, NULL 'NULL')", stream)
  }
}

/**
 * Copies [rows] into [table] over [streams] connections at once, so that both stringifying the rows
 * and Postgres ingesting them get more than one core.
 */
fun <V> copyToPgInParallel(
    table: String,
    rows: Iterator<V>,
    streams: Int,
    hikari: HikariDataSource,
    convert: (value: V, csv: StringBuilder) -> Unit) {
  val errors = ConcurrentLinkedQueue<Throwable>()
  val threads =
      (0 until streams).map {
        Thread {
          try {
            copyStreamToPg(table, StringifyingInputStream(ClaimingIterator(rows), convert), hikari)
          } catch (e: Throwable) {
            errors.add(e)
          }
        }
      }
  threads.forEach { it.start() }
  threads.forEach { it.join() }
  // Once one stream's iterator throws, the others see Kotlin's "Iterator has failed" instead, and
  // whichever stream finishes failing first is not necessarily the one with the real cause.
  val first = errors.poll() ?: return
  errors.forEach { first.addSuppressed(it) }
  throw first
}

// Rows each stream claims at once from the shared iterator, which only one thread can advance at a
// time.
private const val CLAIM_BATCH_SIZE = 1024

/** Takes rows off an iterator shared with other threads, a batch at a time. */
private class ClaimingIterator<V>(private val shared: Iterator<V>) : Iterator<V> {

  private val batch = ArrayDeque<V>()

  override fun hasNext(): Boolean {
    if (batch.isEmpty()) {
      synchronized(shared) {
        while (batch.size < CLAIM_BATCH_SIZE && shared.hasNext()) {
          batch.addLast(shared.next())
        }
      }
    }
    return batch.isNotEmpty()
  }

  override fun next(): V {
    if (!hasNext()) {
      throw NoSuchElementException()
    }
    return batch.removeFirst()
  }
}

/**
 * Returns the date the import's data is from as YYMMDD, followed by two digits counting the
 * imports already made of that date. Keep in sync with Frontend.kt#epochDate.
 */
private fun chooseEpoch(activeEpochs: Set<Int>): Int {
  val now = LocalDateTime.now(ZoneOffset.UTC)
  if (now.hour < 1 && now.minute < 15) {
    throw RuntimeException("Don't do this")
  }
  // TODO(april): roll back month
  val date = (now.year % 100) * 10000 + now.month.value * 100 + (now.dayOfMonth - 1)
  val first = date * 100
  val sameDate = activeEpochs.filter { it in first until first + 100 }
  val next = if (sameDate.isEmpty()) first else sameDate.max() + 1
  // Finishing drops every epoch but the new one, so it has to sort after the live one too.
  return maxOf(next, (activeEpochs.maxOrNull() ?: 0) + 1)
}
