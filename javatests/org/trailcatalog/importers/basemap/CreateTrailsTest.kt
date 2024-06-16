package org.trailcatalog.importers.basemap

import com.google.common.truth.Truth.assertThat
import org.junit.Test
import org.trailcatalog.importers.pbf.LatLngE7
import org.trailcatalog.proto.WayGeometry

class CreateTrailsTest {

  @Test
  fun testNestedRelationIsValid() {
    // 2024-06-16: popsicle
    assertThat(isValid(4813557)).isTrue()
  }

  @Test
  fun testSimpleRelationIsValid() {
    // 2024-06-16: two ways
    assertThat(isValid(4137055)).isTrue()
  }

  @Test
  fun testBrokenRelationIsBroken() {
    // 2024-06-16: I hate it
    assertThat(isValid(17639740)).isFalse()
  }
}

private fun isValid(id: Long): Boolean {
  val mapped = HashMap<Long, List<LatLngE7>>()
  val ways = HashMap<Long, WayGeometry>()
  val flattened = flattenWays(fetchRelation(id), mapped, ways, false)
  return flattened != null
}