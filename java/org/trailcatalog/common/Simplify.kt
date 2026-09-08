package org.trailcatalog.common

import java.util.Stack
import kotlin.math.ln
import kotlin.math.pow
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * Douglas-Peucker over E7 lat/lng pairs, dropping any vertex within epsilon of the chord across it.
 *
 * Epsilon is in the Mercator units [project] hands back, which is the space the client draws in, so
 * a tolerance stated in it is a tolerance in pixels. One Mercator unit is 180 degrees of longitude,
 * so divide an angle in radians by pi.
 */
fun simplifyLatLngE7(degrees: IntArray, epsilon: Double): IntArray {
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

  val keep = BooleanArray(pointCount)
  keep[0] = true
  keep[pointCount - 1] = true
  val spans = Stack<Pair<Int, Int>>()
  spans.push(Pair(0, pointCount - 1))
  while (spans.isNotEmpty()) {
    val (startI, endI) = spans.pop()
    if (endI <= startI + 1) {
      continue
    }

    val startX = projected[2 * startI]
    val startY = projected[2 * startI + 1]
    val dx = projected[2 * endI] - startX
    val dy = projected[2 * endI + 1] - startY
    val lengthSquared = dx * dx + dy * dy

    var biggest = 0.0
    var furthest = -1
    for (i in startI + 1 until endI) {
      val px = projected[2 * i] - startX
      val py = projected[2 * i + 1] - startY
      // Measure to the segment, not to the infinite line through it, so that epsilon really
      // bounds how far the result moves. A vertex past either end is further from the polyline we
      // hand back than its perpendicular says. Clamping t to zero also handles a closed span,
      // which has no direction, by measuring from its ends.
      val t =
          if (lengthSquared > 0.0) {
            ((px * dx + py * dy) / lengthSquared).coerceIn(0.0, 1.0)
          } else {
            0.0
          }
      val distance = sqrt((px - t * dx).pow(2) + (py - t * dy).pow(2))
      if (distance > biggest) {
        biggest = distance
        furthest = i
      }
    }

    // Keep the split point in both halves, or else a vertex that the chord across it does clear
    // gets dropped along with the ones it was standing in for.
    if (furthest > -1 && biggest > epsilon) {
      keep[furthest] = true
      spans.push(Pair(startI, furthest))
      spans.push(Pair(furthest, endI))
    }
  }

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
