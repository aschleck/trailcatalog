package org.trailcatalog.common

import com.google.common.truth.Truth.assertThat
import java.util.Random
import org.junit.Test

class DeltaLatLngE7Test {

  @Test
  fun roundTripsEmpty() {
    assertThat(DeltaLatLngE7.decode(DeltaLatLngE7.encode(IntArray(0)))).isEmpty()
    assertThat(DeltaLatLngE7.pointCount(DeltaLatLngE7.encode(IntArray(0)))).isEqualTo(0)
  }

  @Test
  fun roundTripsOnePoint() {
    val points = intArrayOf(475_000_000, -1_223_000_000)
    assertThat(DeltaLatLngE7.decode(DeltaLatLngE7.encode(points))).isEqualTo(points)
  }

  @Test
  fun roundTripsTheExtremes() {
    // A longitude at the antimeridian is the case that rules out zigzagging the first point.
    val points = intArrayOf(900_000_000, 1_800_000_000, -900_000_000, -1_800_000_000)
    assertThat(DeltaLatLngE7.decode(DeltaLatLngE7.encode(points))).isEqualTo(points)
  }

  @Test
  fun roundTripsRandomPolylines() {
    val random = Random(/* seed= */ 20260726)
    for (trial in 0 until 500) {
      val pointCount = 1 + random.nextInt(200)
      val points = IntArray(2 * pointCount)
      var lat = random.nextInt(1_800_000_000) - 900_000_000
      var lng = random.nextInt(2_000_000_000) - 1_000_000_000
      for (i in 0 until pointCount) {
        // Steps of up to a degree, so the deltas span every varint width.
        lat += random.nextInt(20_000_000) - 10_000_000
        lng += random.nextInt(20_000_000) - 10_000_000
        points[2 * i] = lat
        points[2 * i + 1] = lng
      }

      val encoded = DeltaLatLngE7.encode(points)
      assertThat(DeltaLatLngE7.pointCount(encoded)).isEqualTo(pointCount)
      assertThat(DeltaLatLngE7.decode(encoded)).isEqualTo(points)
      assertThat(encoded.size).isAtMost(DeltaLatLngE7.bytesFor(pointCount))
    }
  }

  @Test
  fun matchesTheWireLayoutTheJavascriptReaderExpects() {
    // Pinned bytes, because camera.ts#projectE7Deltas reads this by hand and nothing else would
    // catch the two of them drifting apart. Covers a forward step, a backward step, and a step of
    // a single E7 unit.
    val points =
        intArrayOf(
            475_000_000, -1_223_000_000,
            475_008_000, -1_223_008_000,
            474_000_000, -1_222_000_000,
            474_000_001, -1_222_000_002)
    val expected = "04c0ec4f1c40801ab7807dff7cff857b80867b0203"
    assertThat(DeltaLatLngE7.encode(points).joinToString("") { "%02x".format(it) })
        .isEqualTo(expected)
    assertThat(DeltaLatLngE7.decode(DeltaLatLngE7.encode(points))).isEqualTo(points)
  }

  @Test
  fun packsNearbyPointsIntoFourBytes() {
    // 8191 E7 is 91 meters, the reach of a two byte zigzag varint.
    val points = intArrayOf(475_000_000, -1_223_000_000, 475_008_000, -1_223_008_000)
    // varint count + two int32 + four bytes of deltas
    assertThat(DeltaLatLngE7.encode(points)).hasLength(1 + 8 + 4)
  }
}
