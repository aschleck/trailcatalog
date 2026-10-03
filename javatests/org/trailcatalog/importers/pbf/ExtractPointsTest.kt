package org.trailcatalog.importers.pbf

import com.google.common.truth.Truth.assertThat
import com.google.protobuf.ByteString
import crosby.binary.Osmformat
import org.junit.Test
import org.trailcatalog.importers.pipeline.collections.Emitter
import org.trailcatalog.models.PointCategory

class ExtractPointsTest {

  @Test
  fun testReadsNewKeys() {
    assertThat(categoryOf("shop" to "supermarket")).isEqualTo(PointCategory.RESUPPLY_SUPERMARKET)
    assertThat(categoryOf("emergency" to "phone")).isEqualTo(PointCategory.SAFETY_EMERGENCY_PHONE)
    assertThat(categoryOf("historic" to "ruins")).isEqualTo(PointCategory.SIGHT_RUINS)
    assertThat(categoryOf("railway" to "halt")).isEqualTo(PointCategory.ACCESS_TRANSIT_STATION)
    assertThat(categoryOf("man_made" to "water_tap")).isEqualTo(PointCategory.WATER_TAP)
  }

  @Test
  fun testObservationTowerNeedsBothTags() {
    assertThat(categoryOf("tower:type" to "observation", "man_made" to "tower"))
        .isEqualTo(PointCategory.SIGHT_OBSERVATION_TOWER)
    assertThat(categoryOf("man_made" to "tower", "tower:type" to "communication")).isNull()
    assertThat(categoryOf("man_made" to "mast", "tower:type" to "observation")).isNull()
  }

  @Test
  fun testDeeperCategoryWins() {
    assertThat(categoryOf("amenity" to "shelter", "highway" to "bus_stop"))
        .isEqualTo(PointCategory.ACCESS_TRANSIT_BUS_STOP)
    assertThat(categoryOf("tourism" to "wilderness_hut", "amenity" to "shelter"))
        .isEqualTo(PointCategory.LODGING_HUT_WILDERNESS)
  }

  @Test
  fun testLaterGroupWins() {
    assertThat(categoryOf("tourism" to "viewpoint", "natural" to "peak"))
        .isEqualTo(PointCategory.NATURAL_PEAK)
    assertThat(categoryOf("shop" to "convenience", "amenity" to "fuel"))
        .isEqualTo(PointCategory.RESUPPLY_FUEL)
    assertThat(categoryOf("mountain_pass" to "yes", "natural" to "saddle"))
        .isEqualTo(PointCategory.NATURAL_MOUNTAIN_PASS)
  }

  @Test
  fun testIgnoresUntrackedValues() {
    assertThat(categoryOf("shop" to "bakery", "name" to "Boulangerie")).isNull()
  }
}

private fun categoryOf(vararg tags: Pair<String, String>): PointCategory? {
  // Index 0 of a PBF string table is always the empty string.
  val strings = ArrayList<String>().also { it.add("") }
  val node = Osmformat.Node.newBuilder().setId(1).setLat(0).setLon(0)
  for ((key, value) in tags) {
    strings.add(key)
    node.addKeys(strings.size - 1)
    strings.add(value)
    node.addVals(strings.size - 1)
  }

  val stringTable = Osmformat.StringTable.newBuilder()
  strings.forEach { stringTable.addS(ByteString.copyFromUtf8(it)) }
  val block =
      Osmformat.PrimitiveBlock.newBuilder()
          .setStringtable(stringTable)
          .addPrimitivegroup(Osmformat.PrimitiveGroup.newBuilder().addNodes(node))
          .build()
  val points = ArrayList<Point>()
  ExtractPoints().act(block, object : Emitter<Point> {
    override fun emit(v: Point) {
      points.add(v)
    }
  })
  return points.singleOrNull()?.let { point -> PointCategory.entries.first { it.id == point.type } }
}
