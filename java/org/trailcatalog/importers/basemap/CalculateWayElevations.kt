package org.trailcatalog.importers.basemap

import com.google.common.geometry.S2CellId
import com.google.common.geometry.S2Earth
import com.google.common.geometry.S2LatLng
import com.google.common.geometry.S2Point
import com.google.common.reflect.TypeToken
import org.trailcatalog.importers.elevation.DemResolver
import org.trailcatalog.importers.elevation.createDemResolver
import org.trailcatalog.importers.pbf.LatLngE7
import org.trailcatalog.importers.pbf.Way
import org.trailcatalog.importers.pipeline.PTransformer
import org.trailcatalog.importers.pipeline.collections.Emitter
import org.trailcatalog.importers.pipeline.collections.PEntry
import org.trailcatalog.s2.earthMetersToAngle

class CalculateWayElevations
    : PTransformer<PEntry<S2CellId, Way>, Profile>(TypeToken.of(Profile::class.java)) {

  private val resolver = createDemResolver()

  // The resolvers wrap tile caches whose thread safety hasn't been audited, and neither has
  // ImageIO's WebP decoding. Stay single-threaded until that's verified.
  override val parallelism: Int = 1

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
  // TODO(april): the sources are coarser than this, 30m for Copernicus and 19m per pixel at the
  // equator for mapterhorn's z12 tiles, so we're oversampling.
  val increment = earthMetersToAngle(5.0)
  val sampleRate = 2

  var totalUp = 0.0
  var totalDown = 0.0
  var totalMeters = 0.0
  // Someone walking a step covers the hypotenuse of its arclength and its rise, not the arclength.
  fun step(radians: Double, dz: Float) {
    if (dz >= 0) {
      totalUp += dz
    } else {
      totalDown -= dz
    }
    totalMeters += Math.hypot(S2Earth.radiansToMeters(radians), dz.toDouble())
  }

  var offsetRadians = 0.0
  var current = 0
  // TODO(april): this actually isn't a bad default because if we have no elevation it likely is
  // at sea-level. But should we think about this more?
  var last = resolver.query(S2LatLng(points[0])) ?: 0f
  val profile = ArrayList<Float>()
  var sampleIndex = 0
  while (current < points.size - 1) {
    val previous = points[current]
    val next = points[current + 1]
    val length = previous.angle(next)
    var position = offsetRadians
    // Where along this segment `last` sits, so a step spans from one sample to the next.
    var lastRadians = 0.0
    while (position < length) {
      // Haversine as opposed to arc interpolation
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

      step(position - lastRadians, height - last)
      last = height
      lastRadians = position
      position += increment.radians()
    }

    // Sampling in fixed increments lands short of the vertex ending the segment, so that stretch is
    // a step of its own or else the steps would sum to less than the way.
    val vertex = resolver.query(S2LatLng(next)) ?: 0f
    step(length - lastRadians, vertex - last)
    last = vertex
    current += 1
    offsetRadians = position - length
  }

  // Always add the last point
  profile.add(last)

  return Profile(
      id=way.id,
      hash=way.hash,
      down=totalDown,
      up=totalUp,
      length=totalMeters,
      profile=profile)
}
