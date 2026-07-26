package org.trailcatalog.importers.elevation.contour

import com.google.common.truth.Truth.assertThat
import org.junit.Test

class CommonTest {

  @Test
  fun testSimplifyContourShouldKeepTwoPoints() {
    val points = listOf(0, 0, 0, 4096)
    val simplified = simplifyContour(points)
    assertThat(simplified).isEqualTo(points)
  }

  @Test
  fun testSimplifyContourShouldElideMiddle() {
    val points = listOf(0, 0, 0, 2048, 0, 4096);
    val simplified = simplifyContour(points)
    assertThat(simplified).isEqualTo(listOf(0, 0, 0, 4096))
  }

  @Test
  fun testSimplifyContourShouldKeepMiddle() {
    val points = listOf(0, 0, 2048, 2048, 0, 4096)
    val simplified = simplifyContour(points)
    assertThat(simplified).isEqualTo(points)
  }

  @Test
  fun testSimplifyContourShouldDropOne() {
    val points = listOf(0, 0, 0, 1024, 0, 2048, 2048, 3864, 0, 4096)
    val simplified = simplifyContour(points)
    assertThat(simplified).isEqualTo(listOf(0, 0, 0, 2048, 2048, 3864, 0, 4096))
  }
}
