package org.trailcatalog.importers.basemap

import com.google.common.geometry.S2Polygon
import com.google.common.truth.Truth.assertThat
import java.io.ByteArrayInputStream
import kotlin.math.PI
import org.junit.Test
import org.trailcatalog.importers.pbf.Relation
import org.trailcatalog.models.RelationCategory.BOUNDARY_ADMINISTRATIVE_10
import org.trailcatalog.importers.pipeline.collections.Emitter
import org.trailcatalog.importers.pipeline.collections.PEntry
import org.trailcatalog.proto.RelationGeometry
import org.trailcatalog.proto.RelationMember
import org.trailcatalog.proto.RelationMemberFunction
import org.trailcatalog.proto.RelationSkeleton
import org.trailcatalog.proto.WayGeometry

class CreateBoundariesTest {

  // 北石ケ町, four ways around a Kyoto city block as of 2026-07-29. The south way starts half a
  // meter south of where the west way starts, so the ring crosses itself in the southwest corner.
  @Test
  fun testRingCrossingItselfEnclosesTheBlockAndNotTheEarth() {
    val polygon =
        boundaryOf(
            // north, west to east
            longArrayOf(
                349291100, 1357073421, 349291100, 1357076640, 349290453, 1357098138,
                349290363, 1357100285, 349290318, 1357104280, 349290294, 1357105185,
                349290284, 1357106351, 349290528, 1357107318, 349290474, 1357108863,
                349290362, 1357111110, 349290767, 1357117867, 349290839, 1357120228),
            // west, south to north
            longArrayOf(349280396, 1357073152, 349291100, 1357073421),
            // south, west to east
            longArrayOf(
                349280396, 1357073152, 349280447, 1357073153, 349280415, 1357075685,
                349280140, 1357097648, 349281169, 1357097661, 349280892, 1357120448),
            // east, north to south
            longArrayOf(349290839, 1357120228, 349280892, 1357120448))

    assertThat(polygon.area).isLessThan(2 * PI)
    // 430 m of longitude by 113 m of latitude, against the Earth's 5.1e14 m^2.
    assertThat(polygon.area * 6371010.0 * 6371010.0).isWithin(2_000.0).of(47_400.0)
  }

  // Custer Gallatin National Forest lists one of its rings twice, and two coincident rings are
  // neither nested nor disjoint.
  @Test
  fun testRingListedTwiceIsTheRingAndNotTheEarth() {
    val ring = squareAround(0, 0, 1_000_000)
    val once = boundaryOf(outer(ring))
    val twice = boundaryOf(outer(ring), outer(ring))

    assertThat(twice.area).isLessThan(2 * PI)
    assertThat(twice.area).isWithin(1e-9).of(once.area)
  }

  // Saddle Mountains East is one BLM way tagged inner with no outer ring anywhere in the relation.
  @Test
  fun testRelationOfNothingButInnerRingsIsItsRings() {
    val ring = squareAround(0, 0, 1_000_000)
    assertThat(boundaryOf(inner(ring)).area).isWithin(1e-9).of(boundaryOf(outer(ring)).area)
  }

  // Sous Préfecture de Samango, relation 19591099, as the nine ways whose ring crosses itself. Its
  // 39 km northern edge and the 18 km edge that closes the ring both end at the same corner and
  // cross 150 m short of it, which is far past any merge distance. S2BooleanOperation only checks
  // that its input is valid through an assert, so union of a ring like this with anything reaches
  // doneBoundaryPair and dies on a sourceIdMap entry that was never added.
  @Test
  fun testRingThatReallyCrossesItselfIsDropped() {
    val samango =
        listOf(
            longArrayOf(96814968, -80843737, 96066422, -77381301),
            longArrayOf(96066422, -77381301, 96018713, -77438164),
            longArrayOf(96018713, -77438164, 95899808, -77875069),
            longArrayOf(95899808, -77875069, 96002523, -78093700),
            longArrayOf(95862500, -78264378, 96002523, -78093700),
            longArrayOf(95934959, -78539766, 95862500, -78264378),
            longArrayOf(95934959, -78539766, 95905744, -79140216),
            longArrayOf(95905744, -79140216, 95834635, -79545698),
            longArrayOf(95834635, -79545698, 96815991, -80836056, 96814968, -80843737))
    val square = squareAround(-500_000_000, 0, 1_000_000)

    val polygon = boundaryOf(outer(samango), outer(square))

    assertThat(polygon.area).isWithin(1e-9).of(boundaryOf(outer(square)).area)
  }

  // Nine of the houses relation 4116274 tags inner, cut down to the corners that matter. Their
  // walls sit within the merge distance of each other, so they assemble into one ring 110 m long
  // and a couple of cells wide, and moving that ring's vertices to their cell centers one at a
  // time crosses its third edge over its last.
  @Test
  fun testRingOnlyCellsWideSurvivesSnapping() {
    val houses =
        listOf(
            longArrayOf(496397489, 181430207, 496399872, 181430596, 496398424, 181430664,
                496397489, 181430207),
            longArrayOf(496400194, 181428567, 496399984, 181427306, 496400099, 181428526,
                496400194, 181428567),
            longArrayOf(496397701, 181428445, 496399955, 181428463, 496399949, 181429464,
                496397701, 181428445),
            longArrayOf(496399766, 181431319, 496399618, 181432194, 496399120, 181432717,
                496399766, 181431319),
            longArrayOf(496399652, 181433874, 496399628, 181434877, 496399409, 181433719,
                496399652, 181433874),
            longArrayOf(496398843, 181438168, 496399092, 181437054, 496398757, 181438120,
                496398843, 181438168),
            longArrayOf(496398587, 181439174, 496396982, 181438483, 496398566, 181439284,
                496398587, 181439174),
            longArrayOf(496395779, 181439354, 496396005, 181438408, 496395926, 181438734,
                496395779, 181439354),
            longArrayOf(496397002, 181434166, 496397569, 181436002, 496399281, 181436146,
                496399038, 181435350, 496397002, 181434166))

    val polygon = boundaryOf(inner(houses))

    assertThat(polygon.area).isLessThan(2 * PI)
    // The nine rings cover 336 m^2 on their own, and merging the walls they share fuses them into
    // one blob of 621.
    assertThat(polygon.area * 6371010.0 * 6371010.0).isGreaterThan(336.0)
    assertThat(polygon.area * 6371010.0 * 6371010.0).isLessThan(1_000.0)
  }

  @Test
  fun testInnerRingIsAHole() {
    val outer = squareAround(0, 0, 1_000_000)
    val inner = squareAround(0, 0, 500_000)
    val polygon = boundaryOf(outer(outer), inner(inner))

    // The hole is half the outer square on a side, so it takes a quarter of the area.
    assertThat(polygon.area).isWithin(0.02).of(0.75 * boundaryOf(outer(outer)).area)
  }
}

// A square of the given half width in e7 degrees, as four ways so nothing depends on a way closing
// on itself.
private fun squareAround(latE7: Int, lngE7: Int, halfE7: Int): List<LongArray> {
  val s = (latE7 - halfE7).toLong()
  val n = (latE7 + halfE7).toLong()
  val w = (lngE7 - halfE7).toLong()
  val e = (lngE7 + halfE7).toLong()
  return listOf(
      longArrayOf(s, w, n, w),
      longArrayOf(n, w, n, e),
      longArrayOf(n, e, s, e),
      longArrayOf(s, e, s, w))
}

private fun outer(ways: List<LongArray>) = ways.map { Pair(RelationMemberFunction.OUTER, it) }

private fun inner(ways: List<LongArray>) = ways.map { Pair(RelationMemberFunction.INNER, it) }

private fun boundaryOf(vararg ways: LongArray) =
    boundaryOf(*ways.map { listOf(Pair(RelationMemberFunction.OUTER, it)) }.toTypedArray())

private fun boundaryOf(
    vararg rings: List<Pair<RelationMemberFunction, LongArray>>): S2Polygon {
  val geometry = RelationGeometry.newBuilder().setRelationId(1)
  for ((i, member) in rings.flatMap { it }.withIndex()) {
    val (function, way) = member
    geometry.addMembers(
        RelationMember.newBuilder()
            .setFunction(function)
            .setWay(
                WayGeometry.newBuilder()
                    .setWayId(i.toLong())
                    .addAllLatLngE7(way.map { it.toInt() })))
  }

  val relation =
      Relation(
          1,
          BOUNDARY_ADMINISTRATIVE_10.id,
          "北石ケ町",
          listOf(),
          RelationSkeleton.getDefaultInstance())
  val boundaries = ArrayList<Boundary>()
  CreateBoundaries().act(
      PEntry(1L, listOf(Pair(listOf(relation), listOf(geometry.build())))),
      object : Emitter<Boundary> {
        override fun emit(v: Boundary) {
          boundaries.add(v)
        }
      })
  assertThat(boundaries).hasSize(1)
  return S2Polygon.decode(ByteArrayInputStream(boundaries[0].s2Polygon()))
}
