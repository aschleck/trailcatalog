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

// A recording drifts 3 or 4 m in altitude over a flat day and Copernicus quotes up to 4 m of
// relative error on steep slopes, so reversals smaller than this are noise. Real climbs lose
// nothing because only the reversal is dropped, never the climb on either side of it.
// Keep in sync with measurements.ts#CLIMB_THRESHOLD_METERS.
private const val CLIMB_THRESHOLD_METERS = 5.0

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
  // but accuracy is nice... Let's calculate at 5m but build the profile every 10m. A z14 pixel,
  // the finest we sample, is 4.8 m at the equator.
  val increment = earthMetersToAngle(5.0)
  val sampleRate = 2

  val climb = ClimbCounter()
  var totalMeters = 0.0
  // Ground walked since the climb last counted a rise, so that a rise which only passes the
  // threshold several steps in is spread over all of them rather than steepening the last one
  var heldMeters = 0.0
  // Someone walking a step covers the hypotenuse of its arclength and its rise, not the arclength.
  // The rise is what the climb counts, or else terrain noise would add to the length what the
  // threshold leaves out of the climb.
  fun step(radians: Double, height: Float) {
    heldMeters += S2Earth.radiansToMeters(radians)
    val rise = climb.add(height)
    if (rise > 0) {
      totalMeters += Math.hypot(heldMeters, rise)
      heldMeters = 0.0
    }
  }

  var offsetRadians = 0.0
  var current = 0
  // TODO(april): this actually isn't a bad default because if we have no elevation it likely is
  // at sea-level. But should we think about this more?
  var last = resolver.query(S2LatLng(points[0])) ?: 0f
  climb.add(last)
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

      step(position - lastRadians, height)
      last = height
      lastRadians = position
      position += increment.radians()
    }

    // Sampling in fixed increments lands short of the vertex ending the segment, so that stretch is
    // a step of its own or else the steps would sum to less than the way.
    val vertex = resolver.query(S2LatLng(next)) ?: 0f
    step(length - lastRadians, vertex)
    last = vertex
    current += 1
    offsetRadians = position - length
  }

  // Always add the last point
  profile.add(last)
  totalMeters += heldMeters

  return Profile(
      id=way.id,
      hash=way.hash,
      down=climb.downMeters,
      up=climb.upMeters,
      length=totalMeters,
      profile=profile)
}

// Follows the running peak or valley and only turns around once the elevation has come back
// CLIMB_THRESHOLD_METERS from it, so a peak counts in full and a wobble counts not at all.
// Keep in sync with measurements.ts#ClimbCounter.
class ClimbCounter {

  var upMeters = 0.0
    private set
  var downMeters = 0.0
    private set
  // The running peak or valley, or the first elevation until the way has moved far enough to have
  // a direction
  private var extreme = Double.NaN
  private var rising: Boolean? = null

  /** Returns the climb or descent this elevation counted, which is 0 or positive either way. */
  fun add(meters: Float): Double {
    val z = meters.toDouble()
    if (extreme.isNaN()) {
      extreme = z
      return 0.0
    } else if (z > extreme && (rising == true || z - extreme >= CLIMB_THRESHOLD_METERS)) {
      val rise = z - extreme
      upMeters += rise
      extreme = z
      rising = true
      return rise
    } else if (z < extreme && (rising == false || extreme - z >= CLIMB_THRESHOLD_METERS)) {
      val fall = extreme - z
      downMeters += fall
      extreme = z
      rising = false
      return fall
    } else {
      return 0.0
    }
  }
}
