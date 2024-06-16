package org.trailcatalog.importers.elevation.contour

import com.google.common.base.Preconditions
import com.google.common.geometry.S2LatLng
import com.google.common.truth.Fact
import com.google.common.truth.FailureMetadata
import com.google.common.truth.Subject
import com.google.common.truth.Truth.assertAbout
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

private fun assertThat(actual: List<S2LatLng>): S2LatLngListSubject {
  return assertAbout(::S2LatLngListSubject).that(actual)
}

private fun assertThat(actual: S2LatLng): S2LatLngSubject {
  return assertAbout(::S2LatLngSubject).that(actual)
}

private class S2LatLngSubject(metadata: FailureMetadata, val actual: S2LatLng)
  : Subject(metadata, actual) {

    fun isEqualToApproximately(expected: S2LatLng) {
      if (!actual.approxEquals(expected)) {
        this.failWithActual(Fact.fact("expected approximately", expected))
      }
    }
}

private class S2LatLngListSubject(metadata: FailureMetadata, val actual: List<S2LatLng>)
  : Subject(metadata, actual) {

  fun isEqualToApproximately(expected: List<S2LatLng>) {
    val extra = ArrayList<S2LatLng>()
    val missing = ArrayList(expected)
    for (item in actual) {
      val index = missing.indexOfFirst { item.approxEquals(it) }
      if (index >= 0) {
        missing.removeAt(index)
      } else {
        extra.add(item)
      }
    }

    val facts = ArrayList<Fact>()

    if (missing.isNotEmpty()) {
      facts.add(Fact.simpleFact("missing (${missing.size})"))
      for (i in missing.indices) {
        facts.add(Fact.fact("#${i}", missing[i]))
      }
      facts.add(Fact.simpleFact(""))
    }

    if (extra.isNotEmpty()) {
      facts.add(Fact.simpleFact("unexpected (${extra.size})"))
      for (i in extra.indices) {
        facts.add(Fact.fact("#${i}", extra[i]))
      }
      facts.add(Fact.simpleFact(""))
    }

    if (facts.isEmpty()) {
      Preconditions.checkArgument(actual.size == expected.size)
      for (i in actual.indices) {
        if (!actual[i].approxEquals(expected[i])) {
          facts.add(Fact.simpleFact("#${i}"))
          facts.add(Fact.fact("expected approximately", expected[i]))
          facts.add(Fact.fact("but was", actual[i]))
        }
      }
    }

    if (facts.isNotEmpty()) {
      facts.add(Fact.fact("expected approximately", expected))
      val rest = facts.stream().skip(1).toArray { n -> Array<Fact?>(n) { null } }
      this.failWithActual(facts[0], *rest)
    }
  }
}
