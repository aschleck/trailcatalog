package org.trailcatalog.importers.elevation

import com.google.common.geometry.S2CellId
import com.google.common.geometry.S2LatLng
import com.google.common.geometry.S2Point
import com.google.common.reflect.TypeToken
import com.zaxxer.hikari.HikariDataSource
import org.trailcatalog.createConnectionSource
import org.trailcatalog.importers.basemap.ELEVATION_PROFILES_FILE
import org.trailcatalog.importers.basemap.ElevationProfilesReader
import org.trailcatalog.importers.basemap.Profile
import org.trailcatalog.importers.basemap.processArgsAndGetPbfs
import org.trailcatalog.importers.pbf.ExtractNodeWayPairs
import org.trailcatalog.importers.pbf.ExtractNodes
import org.trailcatalog.importers.pbf.ExtractRelationGeometriesWithWays
import org.trailcatalog.importers.pbf.ExtractRelations
import org.trailcatalog.importers.pbf.ExtractWays
import org.trailcatalog.importers.pbf.GatherWayNodes
import org.trailcatalog.importers.pbf.MakeWayGeometries
import org.trailcatalog.importers.pbf.PbfBlockReader
import org.trailcatalog.importers.pbf.Relation
import org.trailcatalog.importers.pbf.Way
import org.trailcatalog.importers.pbf.WaySkeleton
import org.trailcatalog.importers.pipeline.PMapTransformer
import org.trailcatalog.importers.pipeline.PSink
import org.trailcatalog.importers.pipeline.PSource
import org.trailcatalog.importers.pipeline.PTransformer
import org.trailcatalog.importers.pipeline.Pipeline
import org.trailcatalog.importers.pipeline.collections.Emitter
import org.trailcatalog.importers.pipeline.collections.Emitter2
import org.trailcatalog.importers.pipeline.collections.PCollection
import org.trailcatalog.importers.pipeline.collections.PEntry
import org.trailcatalog.importers.pipeline.collections.Serializer
import org.trailcatalog.importers.pipeline.collections.getSerializer
import org.trailcatalog.importers.pipeline.collections.registerSerializer
import org.trailcatalog.importers.pipeline.groupBy
import org.trailcatalog.importers.pipeline.io.ChannelEncodedOutputStream
import org.trailcatalog.importers.pipeline.io.EncodedInputStream
import org.trailcatalog.importers.pipeline.io.EncodedOutputStream
import org.trailcatalog.models.RelationCategory
import org.trailcatalog.proto.RelationGeometry
import org.trailcatalog.s2.earthMetersToAngle
import java.io.RandomAccessFile
import java.nio.channels.FileChannel.MapMode

fun main(args: Array<String>) {
  registerSerializer(TypeToken.of(S2CellId::class.java), object : Serializer<S2CellId> {

    override fun read(from: EncodedInputStream): S2CellId {
      return S2CellId(from.readLong())
    }

    override fun write(v: S2CellId, to: EncodedOutputStream) {
      to.writeLong(v.id())
    }
  })

  val (_, pbfs) = processArgsAndGetPbfs(args)

  createConnectionSource(syncCommit = false).use { hikari ->
    val pipeline = Pipeline()

    val ways =
        pipeline.cat(
            pbfs.map { p ->
              pipeline
                  .read(PbfBlockReader(p, readNodes = false, readRelations = false, readWays = true))
                  .then(ExtractWays())
            })
            .groupBy("GroupWays") { it.id }

    val relations =
        pipeline.cat(
            pbfs.map { p ->
              pipeline
                  .read(PbfBlockReader(p, readNodes = false, readRelations = true, readWays = false))
                  .then(ExtractRelations())
            })
            .groupBy("GroupRelations") { it.id }
    val relationsToGeometriesWithWays = relations.then(ExtractRelationGeometriesWithWays())
    val waysInRelations =
        pipeline.join2("JoinOnRelation", relations, relationsToGeometriesWithWays)
            .then(
                object : PTransformer<PEntry<Long, Pair<List<Relation>, List<RelationGeometry>>>, Long>(
                    TypeToken.of(Long::class.java)) {
                  override fun act(
                      input: PEntry<Long, Pair<List<Relation>, List<RelationGeometry>>>,
                      emitter: Emitter<Long>) {
                    for (value in input.values) {
                      val isTrail = value.first.any { RelationCategory.TRAIL.isParentOf(it.type) }
                      if (isTrail) {
                        value.second.forEach { emitWays(it, emitter) }
                      }
                    }
                  }

                  private fun emitWays(relation: RelationGeometry, emitter: Emitter<Long>) {
                    for (member in relation.membersList) {
                      if (member.hasRelation()) {
                        emitWays(member.relation, emitter)
                      }
                      if (member.hasWay()) {
                        emitter.emit(member.way.wayId)
                      }
                    }
                  }
                })
            .groupBy("GatherWaysInRelations") { it }

    val relevantWays =
        pipeline.join2("JoinForRelevantWays", ways, waysInRelations)
            .then(
                object : PMapTransformer<PEntry<Long, Pair<List<WaySkeleton>, List<Long>>>, Long, WaySkeleton>(
                    "FilterRelevantWays",
                    TypeToken.of(Long::class.java),
                    TypeToken.of(WaySkeleton::class.java)) {
                  override fun act(
                      input: PEntry<Long, Pair<List<WaySkeleton>, List<Long>>>,
                      emitter: Emitter2<Long, WaySkeleton>) {
                    for (value in input.values) {
                      if (value.first.isNotEmpty() && value.second.isNotEmpty()) {
                        emitter.emit(input.key, value.first[0])
                      }
                    }
                  }
                })

    val existingProfiles =
        pipeline.read(ElevationProfilesReader()).groupBy("GroupProfiles") { it.id }

    val waysSources = pipeline.join2("JoinExistingProfiles", relevantWays, existingProfiles)
    val alreadyHadProfiles =
        waysSources
            .then(
                object : PTransformer<PEntry<Long, Pair<List<WaySkeleton>, List<Profile>>>, Profile>(
                    TypeToken.of(Profile::class.java)) {
                  override fun act(
                      input: PEntry<Long, Pair<List<WaySkeleton>, List<Profile>>>,
                      emitter: Emitter<Profile>) {
                    for (value in input.values) {
                      if (value.first.isEmpty()) {
                        continue
                      }

                      val version = value.first[0].version
                      val hasVersion = value.second.any { it.version == version }
                      if (hasVersion) {
                        emitter.emit(value.second[0])
                      }
                    }
                  }
                })
    val missingWays =
        waysSources
            .then(
                object : PMapTransformer<PEntry<Long, Pair<List<WaySkeleton>, List<Profile>>>, Long, WaySkeleton>(
                    "FilterForMissingProfiles",
                    TypeToken.of(Long::class.java),
                    TypeToken.of(WaySkeleton::class.java)) {
                  override fun act(
                      input: PEntry<Long, Pair<List<WaySkeleton>, List<Profile>>>,
                      emitter: Emitter2<Long, WaySkeleton>) {
                    for (value in input.values) {
                      if (value.first.isEmpty()) {
                        continue
                      }

                      val version = value.first[0].version
                      val hasVersion = value.second.any { it.version == version }
                      if (!hasVersion) {
                        emitter.emit(input.key, value.first[0])
                      }
                    }
                  }
                })

    val nodes =
        pipeline.cat(
            pbfs.map { p ->
              pipeline
                  .read(PbfBlockReader(p, readNodes = true, readRelations = false, readWays = false))
                  .then(ExtractNodes())
            })
            .groupBy("GroupNodes") { it.id }
    val waysToPoints =
        pipeline
            .join2("JoinNodesForWayPoints", nodes, missingWays.then(ExtractNodeWayPairs()))
            .then(GatherWayNodes())
    val waysWithGeometry =
        pipeline
            .join2("JoinWaysForGeometry", relevantWays, waysToPoints)
            .then(MakeWayGeometries())
            .then(object : PTransformer<PEntry<Long, Way>, Way>(TypeToken.of(Way::class.java)) {
              override fun act(input: PEntry<Long, Way>, emitter: Emitter<Way>) {
                emitter.emit(input.values[0])
              }
            })
    val waysByCells = waysWithGeometry.groupBy("GroupWaysByCells") {
      S2CellId.fromLatLng(it.points[0].toS2LatLng()).parent(7)
    }
    val calculatedProfiles = waysByCells.then(CalculateProfiles(hikari))

    pipeline.cat(listOf(alreadyHadProfiles, calculatedProfiles))
        .write(object : PSink<PCollection<Profile>>() {
          override fun write(input: PCollection<Profile>) {
            val serializer = getSerializer(TypeToken.of(Profile::class.java))

            RandomAccessFile(ELEVATION_PROFILES_FILE, "rw").use {
              ChannelEncodedOutputStream(it.channel).use { output ->
                while (input.hasNext()) {
                  serializer.write(input.next(), output)
                }
                input.close()
              }
            }
          }
        })

    pipeline.execute()
  }
}

private class CalculateProfiles(hikari: HikariDataSource)
    : PTransformer<PEntry<S2CellId, Way>, Profile>(TypeToken.of(Profile::class.java)) {

  private val resolver = DemResolver(hikari)

  override fun act(input: PEntry<S2CellId, Way>, emitter: Emitter<Profile>) {
    for (way in input.values) {
      emitter.emit(calculateProfile(way, resolver))
    }
  }
}

private fun calculateProfile(way: Way, resolver: DemResolver): Profile {
  val points = way.points.map { it.toS2LatLng().toPoint() }

  // 1609 meters to a mile, so at four bytes per meter we'd pay 6.4kb per mile. Seems like a lot,
  // but accuracy is nice... Let's calculate at 5m but build the profile every 10m.
  val increment = earthMetersToAngle(5.0)
  val sampleRate = 2

  var offsetRadians = 0.0
  var current = 0
  var last: Float
  var totalUp = 0.0
  var totalDown = 0.0
  val profile = ArrayList<Float>()
  var sampleIndex = 0
  while (current < points.size - 1) {
    val previous = points[current]
    val next = points[current + 1]
    val length = previous.angle(next)
    var position = offsetRadians
    last = resolver.query(S2LatLng(previous))
    while (position < length) {
      val fraction = Math.sin(position) / Math.sin(length)
      val ll =
          S2LatLng(
              S2Point.add(
                  S2Point.mul(previous, Math.cos(position) - fraction * Math.cos(length)),
                  S2Point.mul(next, fraction)))
      val height = resolver.query(ll)
      if (sampleIndex % sampleRate == 0) {
        profile.add(height)
      }
      sampleIndex += 1

      val dz = height - last
      if (dz >= 0) {
        totalUp += dz
      } else {
        totalDown -= dz
      }
      last = height
      position += increment.radians()
    }
    current += 1
    offsetRadians = position - length

    // Make sure we've always added the last point to the profile
    if (current == points.size - 1 && sampleIndex % sampleRate != 1) {
      profile.add(last)
    }
  }

  return Profile(id=way.id, version=way.version, down=totalDown, up=totalUp, profile=profile)
}