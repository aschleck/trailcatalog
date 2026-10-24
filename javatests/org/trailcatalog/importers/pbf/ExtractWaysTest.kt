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
    assertThat(traitsOf("sac_scale" to "T3", "informal" to "no", "tracktype" to "grade6"))
        .isEqualTo(0)
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
  return wayTraits(way, stringTable)
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
