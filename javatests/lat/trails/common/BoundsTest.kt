package lat.trails.common

import com.google.common.truth.Truth.assertThat
import org.junit.Test

class BoundsTest {

  @Test
  fun testLineAcrossTheAntimeridianTakesTheShortWay() {
    val bound = latLngE7Bound(intArrayOf(-17_0000000, 179_5000000, -17_1000000, -179_5000000))

    assertThat(bound.lngLo().degrees()).isWithin(1e-9).of(179.5)
    assertThat(bound.lngHi().degrees()).isWithin(1e-9).of(-179.5)
    assertThat(bound.lng().length).isWithin(1e-9).of(Math.toRadians(1.0))
  }

  @Test
  fun testUnionAcrossTheAntimeridianTakesTheShortWay() {
    val east = latLngE7Bound(intArrayOf(-17_0000000, 179_0000000, -17_1000000, 179_5000000))
    val west = latLngE7Bound(intArrayOf(-17_0000000, -179_5000000, -17_1000000, -179_0000000))
    val union = east.union(west)

    assertThat(union.lngLo().degrees()).isWithin(1e-9).of(179.0)
    assertThat(union.lngHi().degrees()).isWithin(1e-9).of(-179.0)
  }

  @Test
  fun testAppendBoundWritesBoundColumnsOrder() {
    val csv = StringBuilder()
    appendBound(latLngE7Bound(intArrayOf(46_0000000, -122_0000000, 47_0000000, -121_0000000)), csv)

    val fields = csv.split(",").map { it.toDouble() }
    assertThat(fields[0]).isWithin(1e-9).of(46.0)
    assertThat(fields[1]).isWithin(1e-9).of(-122.0)
    assertThat(fields[2]).isWithin(1e-9).of(47.0)
    assertThat(fields[3]).isWithin(1e-9).of(-121.0)
  }
}
