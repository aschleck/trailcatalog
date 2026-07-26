package org.trailcatalog.s2

import com.google.common.geometry.S2CellId
import com.google.common.geometry.S2LatLng
import com.google.common.truth.Truth.assertThat
import org.junit.Test

private const val TWO_PI = 2 * Math.PI

class SimpleS2Test {

  private fun cover(lat1: Double, lng1: Double, lat2: Double, lng2: Double) =
      SimpleS2.cover(lat1, lat2, lng1, lng2, 2)

  @Test
  fun testCover() {
    val low = S2LatLng.fromDegrees(0.5, 0.5)
    val high = S2LatLng.fromDegrees(0.51, 0.51)
    assertThat(
        cover(low.latRadians(), low.lngRadians(), high.latRadians(), high.lngRadians())
    ).containsExactly(
        S2CellId.fromFacePosLevel(0, 0x1000000000000000, 0),
        S2CellId.fromFacePosLevel(0, 0x400000000000000, 1),
        S2CellId.fromFacePosLevel(0, 0xc00000000000000, 1),
        S2CellId.fromFacePosLevel(0, 0x1400000000000000, 1),
        S2CellId.fromFacePosLevel(0, 0x1c00000000000000, 1),
        S2CellId.fromFacePosLevel(0, 0x500000000000000, 2),
        S2CellId.fromFacePosLevel(0, 0xd00000000000000, 2),
        S2CellId.fromFacePosLevel(0, 0xf00000000000000, 2),
        S2CellId.fromFacePosLevel(0, 0x1100000000000000, 2),
        S2CellId.fromFacePosLevel(0, 0x1300000000000000, 2),
        S2CellId.fromFacePosLevel(0, 0x1500000000000000, 2),
        S2CellId.fromFacePosLevel(0, 0x1700000000000000, 2),
        S2CellId.fromFacePosLevel(0, 0x1900000000000000, 2),
        S2CellId.fromFacePosLevel(0, 0x1b00000000000000, 2),
    )
  }

  @Test
  fun testCoverWrapsWest() {
    assertThat(
        cover(0.618773961033042, -3.850112038305715, 0.6248361958573917, -3.832050769157258)
    ).containsExactly(
        S2CellId.fromFacePosLevel(1, 0x1000000000000000, 0),
        S2CellId.fromFacePosLevel(2, 0x1000000000000000, 0),
        S2CellId.fromFacePosLevel(3, 0x1000000000000000, 0),
        S2CellId.fromFacePosLevel(1, 0x1400000000000000, 1),
        S2CellId.fromFacePosLevel(2, 0x1c00000000000000, 1),
        S2CellId.fromFacePosLevel(3, 0x400000000000000, 1),
        S2CellId.fromFacePosLevel(1, 0x1300000000000000, 2),
        S2CellId.fromFacePosLevel(1, 0x1500000000000000, 2),
        S2CellId.fromFacePosLevel(1, 0x1700000000000000, 2),
        S2CellId.fromFacePosLevel(2, 0x1900000000000000, 2),
        S2CellId.fromFacePosLevel(2, 0x1b00000000000000, 2),
        S2CellId.fromFacePosLevel(2, 0x1d00000000000000, 2),
        S2CellId.fromFacePosLevel(2, 0x1f00000000000000, 2),
        S2CellId.fromFacePosLevel(3, 0x100000000000000, 2),
        S2CellId.fromFacePosLevel(3, 0x300000000000000, 2),
        S2CellId.fromFacePosLevel(3, 0x500000000000000, 2),
        S2CellId.fromFacePosLevel(3, 0x700000000000000, 2),
    )
  }

  @Test
  fun testCoverWrapsEast() {
    assertThat(
        cover(0.8067143704313814, 4.160404578898066, 0.8187419705647867, 4.202770354267652)
    ).containsExactly(
        S2CellId.fromFacePosLevel(2, 0x1000000000000000, 0),
        S2CellId.fromFacePosLevel(3, 0x1000000000000000, 0),
        S2CellId.fromFacePosLevel(4, 0x1000000000000000, 0),
        S2CellId.fromFacePosLevel(2, 0xc00000000000000, 1),
        S2CellId.fromFacePosLevel(2, 0x1400000000000000, 1),
        S2CellId.fromFacePosLevel(3, 0x1c00000000000000, 1),
        S2CellId.fromFacePosLevel(4, 0x400000000000000, 1),
        S2CellId.fromFacePosLevel(4, 0xc00000000000000, 1),
        S2CellId.fromFacePosLevel(2, 0xd00000000000000, 2),
        S2CellId.fromFacePosLevel(2, 0xf00000000000000, 2),
        S2CellId.fromFacePosLevel(2, 0x1100000000000000, 2),
        S2CellId.fromFacePosLevel(2, 0x1300000000000000, 2),
        S2CellId.fromFacePosLevel(2, 0x1500000000000000, 2),
        S2CellId.fromFacePosLevel(2, 0x1700000000000000, 2),
        S2CellId.fromFacePosLevel(3, 0x1d00000000000000, 2),
        S2CellId.fromFacePosLevel(3, 0x1f00000000000000, 2),
        S2CellId.fromFacePosLevel(4, 0x100000000000000, 2),
        S2CellId.fromFacePosLevel(4, 0x700000000000000, 2),
        S2CellId.fromFacePosLevel(4, 0x900000000000000, 2),
    )
  }

  @Test
  fun testCoverStraddlesAntimeridian() {
    assertThat(
        cover(0.6, 3.10, 0.62, 3.18)
    ).containsExactly(
        S2CellId.fromFacePosLevel(2, 0x1000000000000000, 0),
        S2CellId.fromFacePosLevel(3, 0x1000000000000000, 0),
        S2CellId.fromFacePosLevel(2, 0x1400000000000000, 1),
        S2CellId.fromFacePosLevel(2, 0x1c00000000000000, 1),
        S2CellId.fromFacePosLevel(3, 0x400000000000000, 1),
        S2CellId.fromFacePosLevel(3, 0x1c00000000000000, 1),
        S2CellId.fromFacePosLevel(2, 0x1500000000000000, 2),
        S2CellId.fromFacePosLevel(2, 0x1700000000000000, 2),
        S2CellId.fromFacePosLevel(2, 0x1900000000000000, 2),
        S2CellId.fromFacePosLevel(2, 0x1f00000000000000, 2),
        S2CellId.fromFacePosLevel(3, 0x100000000000000, 2),
        S2CellId.fromFacePosLevel(3, 0x300000000000000, 2),
        S2CellId.fromFacePosLevel(3, 0x500000000000000, 2),
        S2CellId.fromFacePosLevel(3, 0x700000000000000, 2),
        S2CellId.fromFacePosLevel(3, 0x1900000000000000, 2),
        S2CellId.fromFacePosLevel(3, 0x1b00000000000000, 2),
        S2CellId.fromFacePosLevel(3, 0x1d00000000000000, 2),
        S2CellId.fromFacePosLevel(3, 0x1f00000000000000, 2),
    )
  }

  /** Panning a whole world east or west lands on the same place, so it must cover the same cells. */
  @Test
  fun testCoverIgnoresWholeWorldShifts() {
    assertThat(cover(0.5, 0.4 + TWO_PI, 0.55, 0.45 + TWO_PI))
        .containsExactlyElementsIn(cover(0.5, 0.4, 0.55, 0.45))
    assertThat(cover(0.5, 0.4 - 2 * TWO_PI, 0.55, 0.45 - 2 * TWO_PI))
        .containsExactlyElementsIn(cover(0.5, 0.4, 0.55, 0.45))
    // Including when the window itself straddles the antimeridian.
    assertThat(cover(0.6, 3.10 - TWO_PI, 0.62, 3.18 - TWO_PI))
        .containsExactlyElementsIn(cover(0.6, 3.10, 0.62, 3.18))
  }

  @Test
  fun testCoverWholeWorld() {
    val cells = cover(-1.5, -4.0, 1.5, 4.0)
    assertThat(cells.filter { it.level() == 0 }).hasSize(6)
    assertThat(cells.filter { it.level() == 1 }).hasSize(24)
    assertThat(cells.filter { it.level() == 2 }).hasSize(96)
  }
}
