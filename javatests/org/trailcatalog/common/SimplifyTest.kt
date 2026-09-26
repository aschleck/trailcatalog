package org.trailcatalog.common

import com.google.common.truth.Truth.assertThat
import java.util.Random
import kotlin.math.ln
import kotlin.math.sin
import org.junit.Test
import org.trailcatalog.s2.snapEpsilon

class SimplifyTest {

  @Test
  fun keepsPolylinesTooShortToSimplify() {
    val two = intArrayOf(475_000_000, -1_223_000_000, 475_010_000, -1_223_010_000)
    assertThat(simplifyLatLngE7(two, LOOSE)).isEqualTo(two)
    assertThat(simplifyLatLngE7(IntArray(0), LOOSE)).isEmpty()
  }

  @Test
  fun keepsTheEndpoints() {
    val points = line(20)
    val simplified = simplifyLatLngE7(points, LOOSE)
    assertThat(simplified.size).isAtLeast(4)
    assertThat(simplified.take(2)).isEqualTo(points.take(2))
    assertThat(simplified.takeLast(2)).isEqualTo(points.takeLast(2))
  }

  @Test
  fun dropsTheInteriorOfAStraightLine() {
    // Every interior vertex sits exactly on the chord, so only the ends survive.
    assertThat(simplifyLatLngE7(line(50), TIGHT).size).isEqualTo(4)
  }

  @Test
  fun keepsACornerSharperThanEpsilon() {
    // A right angle a full degree out from the chord across it, past any epsilon here.
    val corner =
        intArrayOf(
            475_000_000, -1_223_000_000,
            485_000_000, -1_223_000_000,
            485_000_000, -1_213_000_000)
    assertThat(simplifyLatLngE7(corner, LOOSE)).isEqualTo(corner)
  }

  @Test
  fun keepsAPinnedVertexOnTheChord() {
    val points = line(50)
    val pinnedLng = points[2 * 20 + 1]
    val simplified = simplifyLatLngE7(points, TIGHT) { _, lng -> lng == pinnedLng }
    assertThat(simplified.toList())
        .isEqualTo(
            listOf(
                points[0], points[1],
                points[40], points[41],
                points[98], points[99]))
  }

  @Test
  fun dropsAWobbleUnderEpsilon() {
    val points = line(50)
    // A quarter of an epsilon of noise on the interior, so the chord across it clears.
    val random = Random(/* seed= */ 20260907)
    val wobbled = points.copyOf()
    for (i in 1 until points.size / 2 - 1) {
      wobbled[2 * i] += (random.nextGaussian() * mercatorToE7(TIGHT) / 4).toInt()
    }
    assertThat(simplifyLatLngE7(wobbled, TIGHT).size).isLessThan(points.size)
  }

  @Test
  fun staysWithinEpsilonOfEveryDroppedPoint() {
    val random = Random(/* seed= */ 20260907)
    for (trial in 0 until 200) {
      val pointCount = 3 + random.nextInt(60)
      val points = IntArray(2 * pointCount)
      var lat = 400_000_000 + random.nextInt(200_000_000)
      var lng = -1_300_000_000 + random.nextInt(200_000_000)
      for (i in 0 until pointCount) {
        lat += random.nextInt(200_000) - 100_000
        lng += random.nextInt(200_000) - 100_000
        points[2 * i] = lat
        points[2 * i + 1] = lng
      }

      val simplified = simplifyLatLngE7(points, LOOSE)
      assertThat(simplified.size % 2).isEqualTo(0)
      assertThat(simplified.size).isAtMost(points.size)
      // Check every original vertex against the polyline that came back. Moving the line further
      // than epsilon is the failure that matters.
      for (i in 0 until pointCount) {
        val distance = distanceToPolyline(points[2 * i], points[2 * i + 1], simplified)
        assertThat(distance).isLessThan(LOOSE * TOLERANCE_SLACK)
      }
    }
  }

  @Test
  fun simplifiesMonotonicallyInEpsilon() {
    val random = Random(/* seed= */ 20260907)
    val pointCount = 400
    val points = IntArray(2 * pointCount)
    var lat = 475_000_000
    var lng = -1_223_000_000
    for (i in 0 until pointCount) {
      lat += random.nextInt(40_000) - 20_000
      lng += random.nextInt(40_000) - 20_000
      points[2 * i] = lat
      points[2 * i + 1] = lng
    }

    var previous = Int.MAX_VALUE
    for (level in intArrayOf(22, 20, 18, 16, 14)) {
      val kept = simplifyLatLngE7(points, snapEpsilon(level)).size
      assertThat(kept).isAtMost(previous)
      previous = kept
    }
    // A coarse level on a line this wiggly should be down to a handful of vertices.
    assertThat(previous).isLessThan(pointCount / 4)
  }

  // The coarse end of what the servers ask for.
  private val LOOSE = snapEpsilon(14)
  // Fine enough that a straight line is all that survives it.
  private val TIGHT = snapEpsilon(22)

  // Only to absorb floating point, since measuring to the segment makes epsilon a real bound.
  private val TOLERANCE_SLACK = 1.0001

  private fun line(pointCount: Int): IntArray {
    val points = IntArray(2 * pointCount)
    for (i in 0 until pointCount) {
      points[2 * i] = 475_000_000
      points[2 * i + 1] = -1_223_000_000 + i * 10_000
    }
    return points
  }
}

// A constant scale at the test's latitude is close enough, since this only sizes the wobble.
private fun mercatorToE7(mercator: Double): Double {
  return mercator * 180 * 10_000_000
}

private fun project(latDegrees: Int, lngDegrees: Int): Pair<Double, Double> {
  val x = lngDegrees / 10_000_000.0 / 180
  val latRadians = latDegrees / 10_000_000.0 / 180 * Math.PI
  val y = ln((1 + sin(latRadians)) / (1 - sin(latRadians))) / (2 * Math.PI)
  return Pair(x, y)
}

private fun distanceToPolyline(latDegrees: Int, lngDegrees: Int, polyline: IntArray): Double {
  val (px, py) = project(latDegrees, lngDegrees)
  var best = Double.MAX_VALUE
  for (i in 0 until polyline.size / 2 - 1) {
    val (ax, ay) = project(polyline[2 * i], polyline[2 * i + 1])
    val (bx, by) = project(polyline[2 * i + 2], polyline[2 * i + 3])
    val dx = bx - ax
    val dy = by - ay
    val lengthSquared = dx * dx + dy * dy
    val t =
        if (lengthSquared == 0.0) {
          0.0
        } else {
          (((px - ax) * dx + (py - ay) * dy) / lengthSquared).coerceIn(0.0, 1.0)
        }
    val cx = ax + t * dx
    val cy = ay + t * dy
    best = best.coerceAtMost(Math.hypot(px - cx, py - cy))
  }
  return best
}
