package org.trailcatalog.importers.basemap

import com.google.common.geometry.S2CellId
import com.google.common.geometry.S2LatLng
import com.google.common.geometry.S2Point
import com.google.common.reflect.TypeToken
import com.zaxxer.hikari.HikariDataSource
import org.trailcatalog.importers.elevation.DemResolver
import org.trailcatalog.importers.pbf.Way
import org.trailcatalog.importers.pipeline.PTransformer
import org.trailcatalog.importers.pipeline.collections.Emitter
import org.trailcatalog.importers.pipeline.collections.PEntry
import org.trailcatalog.s2.earthMetersToAngle

class CalculateWayElevations(hikari: HikariDataSource)
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
  // TODO(april): we're calculating using Copernicus which is 30m, so...?
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
    // TODO(april): this actually isn't a bad default because if we have no elevation it likely is
    // at sea-level. But should we think about this more?
    last = resolver.query(S2LatLng(previous)) ?: 0f
    while (position < length) {
      val fraction = Math.sin(position) / Math.sin(length)
      val ll =
          S2LatLng(
              S2Point.add(
                  S2Point.mul(previous, Math.cos(position) - fraction * Math.cos(length)),
                  S2Point.mul(next, fraction)))
      val height = resolver.query(ll) ?: 0f
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

  return Profile(id=way.id, hash=way.hash, down=totalDown, up=totalUp, profile=profile)
}