package org.trailcatalog.importers.pbf

import com.google.common.truth.Truth.assertThat
import com.google.protobuf.ByteString
import crosby.binary.Osmformat
import org.junit.Test
import org.trailcatalog.models.PathTrait

class ExtractWaysTest {

  @Test
  fun testUntaggedIsZero() {
    assertThat(traitsOf("highway" to "path")).isEqualTo(0)
  }

  @Test
  fun testPacksEachTrait() {
    val traits =
        traitsOf(
            "highway" to "path",
            "tracktype" to "grade4",
            "informal" to "yes",
            "sac_scale" to "alpine_hiking",
            "trail_visibility" to "no",
            "piste:difficulty" to "extreme")
    assertThat(gradeOf(traits, PathTrait.TRACKTYPE)).isEqualTo(4)
    assertThat(gradeOf(traits, PathTrait.INFORMAL)).isEqualTo(1)
    assertThat(gradeOf(traits, PathTrait.SAC_SCALE)).isEqualTo(4)
    assertThat(gradeOf(traits, PathTrait.TRAIL_VISIBILITY)).isEqualTo(6)
    assertThat(gradeOf(traits, PathTrait.PISTE_DIFFICULTY)).isEqualTo(7)
  }

  @Test
  fun testIgnoresUnknownGrades() {
    assertThat(traitsOf("sac_scale" to "T3", "informal" to "no", "tracktype" to "grade6"))
        .isEqualTo(0)
  }

  @Test
  fun testTraitsDoNotOverlap() {
    var used = 0
    for (trait in PathTrait.values()) {
      val bits = trait.mask shl trait.shift
      assertThat(used and bits).isEqualTo(0)
      assertThat(trait.mask).isAtLeast(trait.grades.size)
      used = used or bits
    }
  }
}

private fun gradeOf(traits: Int, trait: PathTrait): Int {
  return (traits shr trait.shift) and trait.mask
}

private fun traitsOf(vararg tags: Pair<String, String>): Int {
  val strings = listOf("") + tags.flatMap { listOf(it.first, it.second) }
  val way = Osmformat.Way.newBuilder().setId(1)
  for (i in tags.indices) {
    way.addKeys(1 + 2 * i)
    way.addVals(2 + 2 * i)
  }
  val stringTable =
      Osmformat.StringTable.newBuilder()
          .addAllS(strings.map { ByteString.copyFromUtf8(it) })
          .build()
  return wayTraits(way.build(), stringTable)
}
