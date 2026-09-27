package org.trailcatalog.importers.basemap

import com.google.common.truth.Truth.assertThat
import org.junit.Test

class ClimbCounterTest {

  @Test
  fun ignoresWobblesSmallerThanTheThreshold() {
    val climb = count(100f, 101f, 100f, 101f, 104f, 100f, 101f)
    assertThat(climb.upMeters).isEqualTo(0.0)
    assertThat(climb.downMeters).isEqualTo(0.0)
  }

  @Test
  fun countsAPeakInFull() {
    val climb = count(0f, 2f, 4f, 6f, 8f, 10f, 8f, 6f, 4f, 2f, 0f)
    assertThat(climb.upMeters).isEqualTo(10.0)
    assertThat(climb.downMeters).isEqualTo(10.0)
  }

  @Test
  fun reportsANoisyDescentAsTheDescentAlone() {
    // A meter of flicker on every other sample over a 20 m drop, like a recording rounded to meters
    val climb = count(*FloatArray(201) { 100f - it / 10f + it % 2 })
    assertThat(climb.upMeters).isEqualTo(0.0)
    assertThat(climb.downMeters).isWithin(1e-4).of(20.0)
  }

  @Test
  fun returnsWhatEachElevationCounted() {
    val climb = ClimbCounter()
    val counted = listOf(0f, 3f, 6f, 8f, 5f, 2f).map { climb.add(it) }
    assertThat(counted).containsExactly(0.0, 0.0, 6.0, 2.0, 0.0, 6.0).inOrder()
  }

  private fun count(vararg meters: Float): ClimbCounter {
    val climb = ClimbCounter()
    for (z in meters) {
      climb.add(z)
    }
    return climb
  }
}
