package lat.trails.common

import com.google.common.geometry.S2LatLng
import com.google.common.geometry.S2Point
import com.google.common.truth.Truth.assertThat
import org.junit.Test

class PolygonsTest {

  @Test
  fun testRingWindingEitherWayEnclosesTheSmallSide() {
    val square = ring(0.0, 0.0, 0.0, 0.01, 0.01, 0.01, 0.01, 0.0)
    val forward = assemblePolygon(listOf(listOf(square)))
    val backward = assemblePolygon(listOf(listOf(square.reversed())))

    assertThat(forward.area).isWithin(1e-12).of(backward.area)
    assertThat(forward.area).isLessThan(1e-7)
    assertThat(forward.area).isGreaterThan(0.0)
  }

  @Test
  fun testRingCrossingItselfFillsBothLobes() {
    val bowtie = ring(46.85, -121.75, 46.86, -121.74, 46.85, -121.74, 46.86, -121.75)
    val polygon = assemblePolygon(listOf(listOf(bowtie)))

    assertThat(polygon.numLoops()).isEqualTo(2)
    assertThat(polygon.area).isGreaterThan(0.0)
  }

  // A closed ring from lat,lng pairs in degrees
  private fun ring(vararg latLngDegrees: Double): List<S2Point> {
    val points =
        (latLngDegrees.indices step 2).map {
          S2LatLng.fromDegrees(latLngDegrees[it], latLngDegrees[it + 1]).toPoint()
        }
    return points + points[0]
  }
}
