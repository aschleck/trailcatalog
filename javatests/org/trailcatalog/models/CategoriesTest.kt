package org.trailcatalog.models

import com.google.common.truth.Truth.assertThat
import org.junit.Test
import org.trailcatalog.models.WayCategory.HIGHWAY
import org.trailcatalog.models.WayCategory.PATH_FOOTWAY
import org.trailcatalog.models.WayCategory.ROAD_MOTORWAY

class CategoriesTest {

  @Test
  fun testIsParentOf() {
    assertThat(HIGHWAY.isParentOf(PATH_FOOTWAY)).isTrue()
  }

  @Test
  fun testNotIsParentOf() {
    assertThat(ROAD_MOTORWAY.isParentOf(PATH_FOOTWAY)).isFalse()
  }
}