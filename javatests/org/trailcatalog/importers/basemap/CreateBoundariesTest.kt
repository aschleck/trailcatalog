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
