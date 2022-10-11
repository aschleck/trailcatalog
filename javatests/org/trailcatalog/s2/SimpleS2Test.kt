package org.trailcatalog.s2

import com.google.common.geometry.S2CellId
import com.google.common.geometry.S2LatLng
import com.google.common.geometry.S2LatLngRect
import com.google.common.truth.Truth.assertThat
import org.junit.Test

class SimpleS2Test {

  @Test
  fun testCover() {
    assertThat(
        SimpleS2.cover(
            S2LatLngRect.fromPointPair(
                S2LatLng.fromDegrees(0.5, 0.5),
                S2LatLng.fromDegrees(0.51, 0.51)),
            2)
    ).containsExactly(
        S2CellId.fromFacePosLevel(0, 0x500000000000000, 2),
        S2CellId.fromFacePosLevel(0, 0xd00000000000000, 2),
        S2CellId.fromFacePosLevel(0, 0xf00000000000000, 2),
        S2CellId.fromFacePosLevel(0, 0x1100000000000000, 2),
        S2CellId.fromFacePosLevel(0, 0x1300000000000000, 2),
        S2CellId.fromFacePosLevel(0, 0x1500000000000000, 2),
        S2CellId.fromFacePosLevel(0, 0x1700000000000000, 2),
        S2CellId.fromFacePosLevel(0, 0x1900000000000000, 2),
        S2CellId.fromFacePosLevel(0, 0x1b00000000000000, 2),
        S2CellId.fromFacePosLevel(0, 0x400000000000000, 1),
        S2CellId.fromFacePosLevel(0, 0xc00000000000000, 1),
        S2CellId.fromFacePosLevel(0, 0x1400000000000000, 1),
        S2CellId.fromFacePosLevel(0, 0x1c00000000000000, 1),
        S2CellId.fromFacePosLevel(1, 0x400000000000000, 1),
        S2CellId.fromFacePosLevel(1, 0x1c00000000000000, 1),
        S2CellId.fromFacePosLevel(2, 0x400000000000000, 1),
        S2CellId.fromFacePosLevel(2, 0xc00000000000000, 1),
        S2CellId.fromFacePosLevel(0, 0x1000000000000000, 0),
        S2CellId.fromFacePosLevel(1, 0x1000000000000000, 0),
        S2CellId.fromFacePosLevel(2, 0x1000000000000000, 0),
        S2CellId.fromFacePosLevel(4, 0x1000000000000000, 0),
        S2CellId.fromFacePosLevel(5, 0x1000000000000000, 0),
    )
  }

  @Test
  fun testCoverWrapsWest() {
    assertThat(
        SimpleS2.cover(
            S2LatLngRect.fromPointPair(
                S2LatLng.fromRadians(0.618773961033042, -3.850112038305715),
                S2LatLng.fromRadians(0.6248361958573917, -3.832050769157258)),
            2)
    ).containsExactly(
        S2CellId.fromFacePosLevel(2, 0x1500000000000000, 2),
        S2CellId.fromFacePosLevel(1, 0x1300000000000000, 2),
        S2CellId.fromFacePosLevel(1, 0x1500000000000000, 2),
        S2CellId.fromFacePosLevel(1, 0x1700000000000000, 2),
        S2CellId.fromFacePosLevel(2, 0x1700000000000000, 2),
        S2CellId.fromFacePosLevel(2, 0x1900000000000000, 2),
        S2CellId.fromFacePosLevel(2, 0x1b00000000000000, 2),
        S2CellId.fromFacePosLevel(2, 0x1d00000000000000, 2),
        S2CellId.fromFacePosLevel(2, 0x1f00000000000000, 2),
        S2CellId.fromFacePosLevel(3, 0x100000000000000, 2),
        S2CellId.fromFacePosLevel(3, 0x300000000000000, 2),
        S2CellId.fromFacePosLevel(3, 0x500000000000000, 2),
        S2CellId.fromFacePosLevel(3, 0x700000000000000, 2),
        S2CellId.fromFacePosLevel(3, 0x1900000000000000, 2),
        S2CellId.fromFacePosLevel(3, 0x1b00000000000000, 2),
        S2CellId.fromFacePosLevel(3, 0x1d00000000000000, 2),
        S2CellId.fromFacePosLevel(3, 0x1f00000000000000, 2),
        S2CellId.fromFacePosLevel(2, 0x1c00000000000000, 1),
        S2CellId.fromFacePosLevel(1, 0xc00000000000000, 1),
        S2CellId.fromFacePosLevel(1, 0x1400000000000000, 1),
        S2CellId.fromFacePosLevel(2, 0x1400000000000000, 1),
        S2CellId.fromFacePosLevel(2, 0xc00000000000000, 1),
        S2CellId.fromFacePosLevel(1, 0x1c00000000000000, 1),
        S2CellId.fromFacePosLevel(2, 0x400000000000000, 1),
        S2CellId.fromFacePosLevel(3, 0x400000000000000, 1),
        S2CellId.fromFacePosLevel(3, 0xc00000000000000, 1),
        S2CellId.fromFacePosLevel(3, 0x1400000000000000, 1),
        S2CellId.fromFacePosLevel(3, 0x1c00000000000000, 1),
        S2CellId.fromFacePosLevel(0, 0xc00000000000000, 1),
        S2CellId.fromFacePosLevel(4, 0x1c00000000000000, 1),
        S2CellId.fromFacePosLevel(4, 0x400000000000000, 1),
        S2CellId.fromFacePosLevel(4, 0xc00000000000000, 1),
        S2CellId.fromFacePosLevel(0, 0x1400000000000000, 1),
        S2CellId.fromFacePosLevel(1, 0x1000000000000000, 0),
        S2CellId.fromFacePosLevel(2, 0x1000000000000000, 0),
        S2CellId.fromFacePosLevel(3, 0x1000000000000000, 0),
        S2CellId.fromFacePosLevel(4, 0x1000000000000000, 0),
        S2CellId.fromFacePosLevel(5, 0x1000000000000000, 0),
        S2CellId.fromFacePosLevel(0, 0x1000000000000000, 0),
    )
  }

  @Test
  fun testCoverWrapsEast() {
    assertThat(
        SimpleS2.cover(
            S2LatLngRect.fromPointPair(
                S2LatLng.fromRadians(0.8067143704313814, 4.160404578898066),
                S2LatLng.fromRadians(0.8187419705647867, 4.202770354267652)),
            2)
    ).containsExactly(
        S2CellId.fromFacePosLevel(2, 0x1300000000000000, 2),
        S2CellId.fromFacePosLevel(2, 0xd00000000000000, 2),
        S2CellId.fromFacePosLevel(4, 0x900000000000000, 2),
        S2CellId.fromFacePosLevel(4, 0x100000000000000, 2),
        S2CellId.fromFacePosLevel(4, 0x700000000000000, 2),
        S2CellId.fromFacePosLevel(2, 0xf00000000000000, 2),
        S2CellId.fromFacePosLevel(2, 0x1100000000000000, 2),
        S2CellId.fromFacePosLevel(2, 0x1500000000000000, 2),
        S2CellId.fromFacePosLevel(2, 0x1700000000000000, 2),
        S2CellId.fromFacePosLevel(2, 0x1900000000000000, 2),
        S2CellId.fromFacePosLevel(2, 0x1b00000000000000, 2),
        S2CellId.fromFacePosLevel(2, 0x1d00000000000000, 2),
        S2CellId.fromFacePosLevel(2, 0x1f00000000000000, 2),
        S2CellId.fromFacePosLevel(3, 0x100000000000000, 2),
        S2CellId.fromFacePosLevel(3, 0x300000000000000, 2),
        S2CellId.fromFacePosLevel(3, 0x1d00000000000000, 2),
        S2CellId.fromFacePosLevel(3, 0x1f00000000000000, 2),
        S2CellId.fromFacePosLevel(1, 0x1c00000000000000, 1),
        S2CellId.fromFacePosLevel(0, 0xc00000000000000, 1),
        S2CellId.fromFacePosLevel(4, 0x400000000000000, 1),
        S2CellId.fromFacePosLevel(4, 0xc00000000000000, 1),
        S2CellId.fromFacePosLevel(0, 0x1400000000000000, 1),
        S2CellId.fromFacePosLevel(1, 0x1400000000000000, 1),
        S2CellId.fromFacePosLevel(2, 0x400000000000000, 1),
        S2CellId.fromFacePosLevel(2, 0xc00000000000000, 1),
        S2CellId.fromFacePosLevel(2, 0x1400000000000000, 1),
        S2CellId.fromFacePosLevel(2, 0x1c00000000000000, 1),
        S2CellId.fromFacePosLevel(3, 0x400000000000000, 1),
        S2CellId.fromFacePosLevel(3, 0x1c00000000000000, 1),
        S2CellId.fromFacePosLevel(0, 0x1000000000000000, 0),
        S2CellId.fromFacePosLevel(1, 0x1000000000000000, 0),
        S2CellId.fromFacePosLevel(2, 0x1000000000000000, 0),
        S2CellId.fromFacePosLevel(3, 0x1000000000000000, 0),
        S2CellId.fromFacePosLevel(4, 0x1000000000000000, 0),
    )
  }
}
