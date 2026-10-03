package org.trailcatalog.importers.pbf

import com.google.common.truth.Truth.assertThat
import com.google.protobuf.ByteString
import crosby.binary.Osmformat
import org.junit.Test
import org.trailcatalog.importers.pipeline.collections.Emitter
import org.trailcatalog.importers.pipeline.collections.PEntry
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

  @Test
  fun testSearchableCategoryKeepsEveryName() {
    val point =
        extract(
            "tourism" to "alpine_hut",
            "name" to "槍ヶ岳山荘",
            "name:en" to "Yarigatake Sanso",
            "name:ja" to "槍ヶ岳山荘",
            "name:etymology" to "the peak")!!
    assertThat(point.name).isEqualTo("槍ヶ岳山荘")
    assertThat(point.names)
        .containsExactly(Name(null, "槍ヶ岳山荘"), Name("en", "Yarigatake Sanso"))
  }

  @Test
  fun testAirportCodesAreNames() {
    val point = extract("aeroway" to "aerodrome", "name" to "Bellingham", "iata" to "BLI")!!
    assertThat(point.type).isEqualTo(PointCategory.ACCESS_TRANSIT_AIRPORT.id)
    assertThat(point.names).containsExactly(Name(null, "Bellingham"), Name(null, "BLI"))
  }

  @Test
  fun testPointIdCarriesSource() {
    assertThat(extract("natural" to "peak")!!.id).isEqualTo(2L)
  }

  @Test
  fun testClosedWayBecomesPointAtCentroid() {
    // Clockwise, so the loop only encloses the square once it's normalized.
    val corners =
        listOf(
            Node(10, LatLngE7(1_0000000, 1_0000000)),
            Node(11, LatLngE7(0, 1_0000000)),
            Node(12, LatLngE7(0, 0)),
            Node(13, LatLngE7(1_0000000, 0)))
    val way =
        WaySkeleton(
            7,
            0,
            "Camp",
            longArrayOf(10, 11, 12, 13, 10),
            PointCategory.LODGING_CAMP_SITE.id,
            listOf(Name(null, "Camp")))
    val points = ArrayList<Point>()
    MakeWayPoints().act(PEntry(7L, listOf(Pair(listOf(way), corners))), object : Emitter<Point> {
      override fun emit(v: Point) {
        points.add(v)
      }
    })

    val point = points.single()
    assertThat(point.id).isEqualTo(15L)
    assertThat(point.name).isEqualTo("Camp")
    assertThat(point.latLng.lat.toDouble()).isWithin(1000.0).of(5000000.0)
    assertThat(point.latLng.lng.toDouble()).isWithin(1000.0).of(5000000.0)
  }

  @Test
  fun testOpenWayIsNoPoint() {
    val strings = listOf("", "tourism", "hotel").map { ByteString.copyFromUtf8(it) }
    val table = Osmformat.StringTable.newBuilder().addAllS(strings).build()
    assertThat(wayPointCategory(listOf(1, 2), longArrayOf(1, 2, 3, 4), table))
        .isEqualTo(PointCategory.ANY)
    assertThat(wayPointCategory(listOf(1, 2), longArrayOf(1, 2, 3, 1), table))
        .isEqualTo(PointCategory.LODGING_ROOM_HOTEL)
  }

  @Test
  fun testOtherCategoryKeepsOnlyItsName() {
    val point = extract("highway" to "bus_stop", "name" to "Main St", "name:es" to "Calle Main")!!
    assertThat(point.name).isEqualTo("Main St")
    assertThat(point.names).isEmpty()
  }
}

private fun categoryOf(vararg tags: Pair<String, String>): PointCategory? {
  return extract(*tags)?.let { point -> PointCategory.entries.first { it.id == point.type } }
}

private fun extract(vararg tags: Pair<String, String>): Point? {
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
  return points.singleOrNull()
}
