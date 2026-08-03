package org.trailcatalog.importers.basemap

import com.google.common.truth.Truth.assertThat
import org.junit.Test
import org.trailcatalog.importers.pbf.LatLngE7
import org.trailcatalog.proto.WayGeometry

class CreateTrailsTest {

  @Test
  fun testNestedRelationIsContinuous() {
    // 2024-06-16: popsicle
    assertThat(flatten(4813557).continuous).isTrue()
  }

  @Test
  fun testSimpleRelationIsContinuous() {
    // 2024-06-16: two ways
    assertThat(flatten(4137055).continuous).isTrue()
  }

  @Test
  fun testBrokenRelationIsBroken() {
    // 2024-06-16: I hate it
    assertThat(flatten(17639740).continuous).isFalse()
  }

  @Test
  fun testSpurredRelationKeepsItsMainLineTogether() {
    // 2026-08-02: the Boundary Trail, with a 25 meter stub and a 100 meter stub hanging off its
    // middle
    val flattened = flatten(5628775)
    assertThat(flattened.continuous).isFalse()
    // The stubs are the two shortest stretches, so they sort to the end and leave the 110 km main
    // line in one piece.
    assertThat(flattened.ids.dropLast(2).map { it / 2 })
        .containsNoneOf(962484855L, 961258419L)
  }
}

private fun flatten(id: Long): FlatWays {
  val mapped = HashMap<Long, List<LatLngE7>>()
  val ways = HashMap<Long, WayGeometry>()
  return flattenWays(fetchRelation(id), mapped, ways)
}
