package org.trailcatalog.importers.elevation

import com.google.common.geometry.S2CellId
import com.google.common.geometry.S2LatLng
import com.google.common.geometry.S2Point
import com.google.common.reflect.TypeToken
import com.zaxxer.hikari.HikariDataSource
import org.trailcatalog.createConnectionSource
import org.trailcatalog.importers.pbf.ExtractNodeWayPairs
import org.trailcatalog.importers.pbf.ExtractNodes
import org.trailcatalog.importers.pbf.ExtractWays
import org.trailcatalog.importers.pbf.GatherWayNodes
import org.trailcatalog.importers.pbf.MakeWayGeometries
import org.trailcatalog.importers.pbf.PbfBlockReader
import org.trailcatalog.importers.pbf.Way
import org.trailcatalog.importers.pipeline.PSink
import org.trailcatalog.importers.pipeline.PTransformer
import org.trailcatalog.importers.pipeline.Pipeline
import org.trailcatalog.importers.pipeline.collections.Emitter
import org.trailcatalog.importers.pipeline.collections.PEntry
import org.trailcatalog.importers.pipeline.collections.PList
import org.trailcatalog.importers.pipeline.collections.Serializer
import org.trailcatalog.importers.pipeline.collections.registerSerializer
import org.trailcatalog.importers.pipeline.groupBy
import org.trailcatalog.importers.pipeline.io.EncodedInputStream
import org.trailcatalog.importers.pipeline.io.EncodedOutputStream
import org.trailcatalog.importers.processArgsAndGetPbfs
import org.trailcatalog.s2.earthMetersToAngle
import kotlin.system.exitProcess

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
            .then(object : PTransformer<PEntry<Long, Way>, Way>(TypeToken.of(Way::class.java)) {
              override fun act(input: PEntry<Long, Way>, emitter: Emitter<Way>) {
                emitter.emit(input.values[0])
              }
            })
    val waysByCells = waysWithGeometry.groupBy("GroupWaysByCells") {
      S2CellId.fromLatLng(it.points[0].toS2LatLng()).parent(7)
    }
    waysByCells.then(CalculateProfiles(hikari)).write(object : PSink<PList<Way>>() {
      override fun write(input: PList<Way>) {
        while (input.hasNext()) {
          input.next()
        }
        input.close()
      }
    })

    pipeline.execute()
  }
}

private class CalculateProfiles(private val hikari: HikariDataSource)
    : PTransformer<PEntry<S2CellId, Way>, Way>(TypeToken.of(Way::class.java)) {
  override fun act(input: PEntry<S2CellId, Way>, emitter: Emitter<Way>) {
    val resolver = DemResolver(hikari)
    input.values.forEach { println(it.id); println(calculateProfile(it, resolver)) }
    exitProcess(0)
  }
}

private data class Profile(
    val id: Long,
    val version: Int,
    val down: Double,
    val up: Double,
    val profile: List<Float>,
)

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