package org.trailcatalog.importers.basemap

import com.google.common.geometry.S2Polygon
import com.google.common.truth.Truth.assertThat
import java.io.ByteArrayInputStream
import org.junit.Test
import org.trailcatalog.importers.pbf.ClimbingElement
import org.trailcatalog.importers.pbf.LatLngE7
import org.trailcatalog.importers.pbf.nodeSiteId
import org.trailcatalog.importers.pbf.waySiteId
import org.trailcatalog.models.RelationCategory
import org.trailcatalog.proto.RelationSkeleton
import org.trailcatalog.proto.RelationSkeletonMember

class CreateClimbingSitesTest {

  @Test
  fun testNodeCragIsACircle() {
    val sites =
        createClimbingSites(
            elementsOf(crag(nodeSiteId(1), LatLngE7(475000000, -1207000000))), mapOf())

    assertThat(sites).hasSize(1)
    assertThat(sites[0].id).isEqualTo(nodeSiteId(1))
    // pi * 5^2 is 78.5, and the 16-gon inside it gives up a little
    assertThat(sites[0].areaMeters2).isWithin(2.0).of(76.5)
  }

  @Test
  fun testRelationIgnoresMembersWithoutClimbingTags() {
    val routes =
        listOf(
            route(nodeSiteId(1), LatLngE7(475000000, -1207000000)),
            route(nodeSiteId(2), LatLngE7(475001000, -1207000000)))
    // The parking lot is a member but isn't in elements because it has no climbing tags.
    val crag = relation(10, RelationCategory.BOUNDARY_CLIMBING_CRAG, "Crag", nodeMembers(1, 2, 3))
    val site = createClimbingSites(elementsOf(crag, *routes.toTypedArray()), mapOf()).single()

    // The routes are 11 meters apart, so this is a 10 by 21 meter stadium.
    assertThat(site.areaMeters2).isWithin(5.0).of(10.0 * 11.1 + 76.5)
    val polygon = decode(site)
    assertThat(polygon.contains(LatLngE7(475000500, -1207000000).toS2LatLng().toPoint())).isTrue()
  }

  @Test
  fun testAreaHoldsItsCragsAndWays() {
    val cragA = relation(10, RelationCategory.BOUNDARY_CLIMBING_CRAG, "A", nodeMembers(1))
    val cragB = crag(waySiteId(5), null)
    val area =
        relation(
            20,
            RelationCategory.BOUNDARY_CLIMBING_AREA,
            "Area",
            listOf(
                RelationSkeletonMember.newBuilder().setRelationId(10).build(),
                RelationSkeletonMember.newBuilder().setWayId(5).build(),
                // cycles back to itself
                RelationSkeletonMember.newBuilder().setRelationId(20).build()))
    val sites =
        createClimbingSites(
            elementsOf(
                route(nodeSiteId(1), LatLngE7(475000000, -1207000000)), cragA, cragB, area),
            mapOf(
                waySiteId(5) to
                    listOf(LatLngE7(475010000, -1207000000), LatLngE7(475010000, -1206990000))))

    assertThat(sites.map { it.name }).containsExactly("A", "Crag", "Area")
    val polygon = decode(sites.single { it.name == "Area" })
    for (vertex in
        listOf(
            LatLngE7(475000000, -1207000000),
            LatLngE7(475010000, -1207000000),
            LatLngE7(475010000, -1206990000))) {
      assertThat(polygon.contains(vertex.toS2LatLng().toPoint())).isTrue()
    }
  }

  @Test
  fun testNamelessSitesAreDropped() {
    val nameless =
        ClimbingElement(
            nodeSiteId(1),
            RelationCategory.BOUNDARY_CLIMBING_CRAG.id,
            "",
            listOf(),
            LatLngE7(475000000, -1207000000),
            RelationSkeleton.getDefaultInstance())

    assertThat(createClimbingSites(elementsOf(nameless), mapOf())).isEmpty()
  }
}

private fun elementsOf(vararg elements: ClimbingElement): Map<Long, ClimbingElement> =
    elements.associateBy { it.id }

private fun crag(id: Long, latLng: LatLngE7?): ClimbingElement =
    ClimbingElement(
        id,
        RelationCategory.BOUNDARY_CLIMBING_CRAG.id,
        "Crag",
        listOf(),
        latLng,
        RelationSkeleton.getDefaultInstance())

private fun route(id: Long, latLng: LatLngE7): ClimbingElement =
    ClimbingElement(
        id,
        RelationCategory.BOUNDARY_CLIMBING.id,
        "",
        listOf(),
        latLng,
        RelationSkeleton.getDefaultInstance())

private fun relation(
    id: Long,
    type: RelationCategory,
    name: String,
    members: List<RelationSkeletonMember>): ClimbingElement =
    ClimbingElement(
        id,
        type.id,
        name,
        listOf(),
        null,
        RelationSkeleton.newBuilder().addAllMembers(members).build())

private fun nodeMembers(vararg ids: Long): List<RelationSkeletonMember> =
    ids.map { RelationSkeletonMember.newBuilder().setNodeId(it).build() }

private fun decode(boundary: Boundary): S2Polygon =
    S2Polygon.decode(ByteArrayInputStream(boundary.s2Polygon))
