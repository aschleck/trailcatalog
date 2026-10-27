package org.trailcatalog.importers.pbf

import com.google.common.truth.Truth.assertThat
import com.google.protobuf.ByteString
import crosby.binary.Osmformat
import org.junit.Test
import org.trailcatalog.models.PathTrait
import org.trailcatalog.models.WayCategory

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
    assertThat(
            traitsOf(
                "highway" to "path",
                "sac_scale" to "T3",
                "informal" to "no",
                "tracktype" to "grade6"))
        .isEqualTo(0)
  }

  @Test
  fun testFoldsValuesIntoGrades() {
    val traits =
        traitsOf(
            "highway" to "path",
            "bicycle" to "dismount",
            "foot" to "permissive",
            "mtb:scale" to "2+",
            "dog" to "unleashed",
            "piste:grooming" to "classic;skating")
    assertThat(gradeOf(traits, PathTrait.BICYCLE)).isEqualTo(1)
    assertThat(gradeOf(traits, PathTrait.FOOT)).isEqualTo(2)
    assertThat(gradeOf(traits, PathTrait.MTB_SCALE)).isEqualTo(3)
    assertThat(gradeOf(traits, PathTrait.DOG)).isEqualTo(3)
    assertThat(gradeOf(traits, PathTrait.PISTE_GROOMING)).isEqualTo(2)
  }

  @Test
  fun testFallsBackToLessSpecificTags() {
    val traits = traitsOf("highway" to "path", "access" to "private", "foot" to "yes")
    assertThat(gradeOf(traits, PathTrait.FOOT)).isEqualTo(2)
    assertThat(gradeOf(traits, PathTrait.BICYCLE)).isEqualTo(1)
    assertThat(gradeOf(traits, PathTrait.HORSE)).isEqualTo(1)
  }

  @Test
  fun testSpecificTagWithoutGradeStopsFallback() {
    val traits = traitsOf("highway" to "path", "oneway" to "yes", "mtb:oneway" to "no")
    assertThat(gradeOf(traits, PathTrait.DIRECTION)).isEqualTo(0)
    assertThat(gradeOf(traitsOf("highway" to "path", "oneway" to "-1"), PathTrait.DIRECTION))
        .isEqualTo(2)
  }

  @Test
  fun testOnlyPathsTracksAndPistesCarryTraits() {
    assertThat(traitsOf("highway" to "residential", "oneway" to "yes", "access" to "no"))
        .isEqualTo(0)
    assertThat(
            gradeOf(traitsOf("highway" to "track", "tracktype" to "grade1"), PathTrait.TRACKTYPE))
        .isEqualTo(1)
    assertThat(
            gradeOf(
                traitsOf("piste:type" to "downhill", "piste:difficulty" to "easy"),
                PathTrait.PISTE_DIFFICULTY))
        .isEqualTo(2)
  }

  @Test
  fun testViaFerrata() {
    val (way, stringTable) = wayOf(listOf(), "highway" to "via_ferrata", "via_ferrata_scale" to "3")
    val category = wayCategory(way, stringTable)
    assertThat(category).isEqualTo(WayCategory.PATH_VIA_FERRATA)
    assertThat(gradeOf(wayTraits(way, category, stringTable), PathTrait.VIA_FERRATA_SCALE))
        .isEqualTo(4)
  }

  @Test
  fun testKeepsTrackThatIsNotInService() {
    // way 453624279
    assertThat(categoryOf("railway" to "disused", "service" to "siding"))
        .isEqualTo(WayCategory.RAIL_SIDING)
    // way 42536619
    assertThat(categoryOf("railway" to "abandoned", "service" to "siding"))
        .isEqualTo(WayCategory.RAIL_SIDING)
  }

  @Test
  fun testIgnoresRailwaysThatAreNotTrack() {
    // way 125740937
    assertThat(categoryOf("railway" to "platform")).isEqualTo(WayCategory.ANY)
    assertThat(categoryOf("railway" to "razed")).isEqualTo(WayCategory.ANY)
    assertThat(categoryOf("railway" to "platform", "highway" to "footway"))
        .isEqualTo(WayCategory.PATH_FOOTWAY)
  }

  @Test
  fun testIgnoresRailroadLand() {
    // way 883999185
    assertThat(categoryOf(listOf(1, 2, 3, 1), "landuse" to "railway", "railway" to "disused"))
        .isEqualTo(WayCategory.ANY)
    // way 284787416
    assertThat(categoryOf(listOf(1, 2, 3), "landuse" to "railway", "railway" to "rail"))
        .isEqualTo(WayCategory.RAIL)
    assertThat(categoryOf(listOf(1, 2, 3, 1), "railway" to "tram")).isEqualTo(WayCategory.RAIL_TRAM)
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
  val (way, stringTable) = wayOf(listOf(), *tags)
  return wayTraits(way, wayCategory(way, stringTable), stringTable)
}

private fun categoryOf(vararg tags: Pair<String, String>): WayCategory {
  return categoryOf(listOf(1, 2), *tags)
}

private fun categoryOf(nodes: List<Long>, vararg tags: Pair<String, String>): WayCategory {
  val (way, stringTable) = wayOf(nodes, *tags)
  return wayCategory(way, stringTable)
}

private fun wayOf(nodes: List<Long>, vararg tags: Pair<String, String>)
    : Pair<Osmformat.Way, Osmformat.StringTable> {
  val strings = listOf("") + tags.flatMap { listOf(it.first, it.second) }
  val way = Osmformat.Way.newBuilder().setId(1)
  // PBF delta codes the refs.
  var last = 0L
  for (node in nodes) {
    way.addRefs(node - last)
    last = node
  }
  for (i in tags.indices) {
    way.addKeys(1 + 2 * i)
    way.addVals(2 + 2 * i)
  }
  val stringTable =
      Osmformat.StringTable.newBuilder()
          .addAllS(strings.map { ByteString.copyFromUtf8(it) })
          .build()
  return Pair(way.build(), stringTable)
}
