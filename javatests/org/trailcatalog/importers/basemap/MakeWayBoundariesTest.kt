package org.trailcatalog.importers.basemap

import com.google.common.truth.Truth.assertThat
import org.junit.Test
import org.trailcatalog.importers.pbf.LatLngE7
import org.trailcatalog.importers.pbf.Name
import org.trailcatalog.importers.pbf.Way
import org.trailcatalog.importers.pbf.WayPoint
import org.trailcatalog.importers.pipeline.collections.Emitter
import org.trailcatalog.importers.pipeline.collections.PEntry
import org.trailcatalog.models.PointCategory
import org.trailcatalog.models.RelationCategory
import org.trailcatalog.models.WAY_BOUNDARY_ID_OFFSET

class MakeWayBoundariesTest {

  @Test
  fun testParkWayBecomesABoundary() {
    val boundaries = make(RelationCategory.BOUNDARY_NATURE_RESERVE)

    val boundary = boundaries.single()
    assertThat(boundary.id).isEqualTo(WAY_BOUNDARY_ID_OFFSET + 7)
    assertThat(boundary.type).isEqualTo(RelationCategory.BOUNDARY_NATURE_RESERVE.id)
    assertThat(boundary.name).isEqualTo("Railroad Trail")
    assertThat(boundary.names).containsExactly(Name(null, "Railroad Trail"))
    // 0.01 degrees of latitude is 1112 m and 0.01 of longitude 750 m at 47.6 degrees.
    assertThat(boundary.areaMeters2).isWithin(10_000.0).of(1112.0 * 750.0)
  }

  @Test
  fun testOtherWayPointsMakeNoBoundary() {
    assertThat(make(RelationCategory.ANY)).isEmpty()
  }

  @Test
  fun testCrossedWayEnclosesItsTwoTriangles() {
    val bowtie =
        listOf(
            LatLngE7(47_6000000, -122_3000000),
            LatLngE7(47_6100000, -122_3100000),
            LatLngE7(47_6100000, -122_3000000),
            LatLngE7(47_6000000, -122_3100000),
            LatLngE7(47_6000000, -122_3000000))
    val boundary = make(RelationCategory.BOUNDARY_NATURE_RESERVE, bowtie).single()
    assertThat(boundary.areaMeters2).isWithin(10_000.0).of(1112.0 * 750.0 / 2)
  }
}

// Clockwise, so the ring only encloses the square once it's turned around.
private val SQUARE =
    listOf(
        LatLngE7(47_6000000, -122_3000000),
        LatLngE7(47_6100000, -122_3000000),
        LatLngE7(47_6100000, -122_3100000),
        LatLngE7(47_6000000, -122_3100000),
        LatLngE7(47_6000000, -122_3000000))

private fun make(
    boundaryType: RelationCategory, points: List<LatLngE7> = SQUARE): List<Boundary> {
  val point =
      WayPoint(
          PointCategory.PARK_NATURE_RESERVE.id,
          "Railroad Trail",
          listOf(Name(null, "Railroad Trail")),
          /* notable= */ false,
          boundaryType.id)
  val way = Way(7, 0, 0, 0, Float.NaN, Float.NaN, Float.NaN, points, point)
  val boundaries = ArrayList<Boundary>()
  MakeWayBoundaries().act(PEntry(7L, listOf(way)), object : Emitter<Boundary> {
    override fun emit(v: Boundary) {
      boundaries.add(v)
    }
  })
  return boundaries
}
