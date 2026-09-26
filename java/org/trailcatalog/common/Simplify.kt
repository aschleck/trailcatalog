package org.trailcatalog.common

import org.trailcatalog.s2.SimpleS2
import kotlin.math.ln
import kotlin.math.sin

/**
 * Douglas-Peucker over E7 lat/lng pairs, dropping any vertex within epsilon of the chord across it.
 *
 * Epsilon is in the Mercator units [project] hands back, which is the space the client draws in, so
 * a tolerance stated in it is a tolerance in pixels. One Mercator unit is 180 degrees of longitude,
 * so divide an angle in radians by pi.
 *
 * A vertex [pinned] answers true for survives regardless of epsilon.
 */
fun simplifyLatLngE7(
    degrees: IntArray,
    epsilon: Double,
    pinned: (latE7: Int, lngE7: Int) -> Boolean = { _, _ -> false },
): IntArray {
  val pointCount = degrees.size / 2
  if (pointCount < 3) {
    return degrees
  }

  // Resolve the deltas up front because Douglas-Peucker seeks by index. One extra pass against the
  // many this already makes over the same points.
  val projected = DoubleArray(degrees.size)
  for (i in 0 until pointCount) {
    val (x, y) = project(degrees[2 * i], degrees[2 * i + 1])
    projected[2 * i] = x
    projected[2 * i + 1] = y
  }

  val pins = BooleanArray(pointCount) { pinned(degrees[2 * it], degrees[2 * it + 1]) }
  val keep = SimpleS2.douglasPeucker(projected, epsilon, pins)

  var kept = 0
  for (i in 0 until pointCount) {
    if (keep[i]) {
      kept += 1
    }
  }

  val simplified = IntArray(2 * kept)
  var at = 0
  for (i in 0 until pointCount) {
    if (!keep[i]) {
      continue
    }
    simplified[2 * at] = degrees[2 * i]
    simplified[2 * at + 1] = degrees[2 * i + 1]
    at += 1
  }
  return simplified
}

/** Projects into Mercator space from -1 to 1. */
private fun project(latDegrees: Int, lngDegrees: Int): Pair<Double, Double> {
  val x = lngDegrees / 10_000_000.0 / 180
  val latRadians = latDegrees / 10_000_000.0 / 180 * Math.PI
  val y = ln((1 + sin(latRadians)) / (1 - sin(latRadians))) / (2 * Math.PI)
  return Pair(x, y)
}
