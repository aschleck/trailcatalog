package org.trailcatalog.importers.basemap

import com.google.common.geometry.S2LatLng
import com.google.common.truth.Truth.assertThat
import org.junit.Test
import org.trailcatalog.importers.pipeline.collections.Emitter2
import org.trailcatalog.importers.pipeline.collections.PEntry
import org.trailcatalog.models.RelationCategory.BOUNDARY_ADMINISTRATIVE_2
import org.trailcatalog.models.RelationCategory.BOUNDARY_ADMINISTRATIVE_6

class TrailsInBoundariesTest {

  private val france = boundary(1, BOUNDARY_ADMINISTRATIVE_2.id, "France", 44.0, 5.0, 46.0, 7.0)
  private val italia = boundary(2, BOUNDARY_ADMINISTRATIVE_2.id, "Italia", 44.0, 7.0, 46.0, 9.0)
  private val schweiz = boundary(3, BOUNDARY_ADMINISTRATIVE_2.id, "Schweiz", 46.0, 5.0, 48.0, 9.0)

  // Coverings reach past a border, so FindTrailsInBoundaries reports a trail near one as contained
  // by both sides.
  @Test
  fun testTrailNearABorderIsOnlyInTheCountryItIsIn() {
    val trail = trailThrough(S2LatLng.fromDegrees(45.0, 6.9), S2LatLng.fromDegrees(45.1, 6.95))
    assertThat(containingIdsOf(trail, france, italia)).containsExactly(1L)
  }

  // Two of the three vertices are in Italia.
  @Test
  fun testTrailAcrossABorderIsInTheCountryWithMostOfIt() {
    val trail =
        trailThrough(
            S2LatLng.fromDegrees(45.0, 6.9),
            S2LatLng.fromDegrees(45.0, 7.1),
            S2LatLng.fromDegrees(45.0, 7.2))
    assertThat(containingIdsOf(trail, france, italia)).containsExactly(2L)
  }

  // Three of the seven vertices are in France, so no country holds most of the trail.
  @Test
  fun testTrailThroughThreeCountriesKeepsTheOneWithTheMost() {
    val trail =
        trailThrough(
            S2LatLng.fromDegrees(45.5, 6.7),
            S2LatLng.fromDegrees(45.6, 6.8),
            S2LatLng.fromDegrees(45.7, 6.9),
            S2LatLng.fromDegrees(45.8, 7.1),
            S2LatLng.fromDegrees(45.9, 7.2),
            S2LatLng.fromDegrees(46.1, 7.3),
            S2LatLng.fromDegrees(46.2, 7.4))
    assertThat(containingIdsOf(trail, france, italia, schweiz)).containsExactly(1L)
  }

  @Test
  fun testOverlappingBoundariesOfOneTypeBothHoldTheTrail() {
    val trail = trailThrough(S2LatLng.fromDegrees(44.6, 6.3), S2LatLng.fromDegrees(44.7, 6.4))
    val type = BOUNDARY_ADMINISTRATIVE_6.id
    val hautesAlpes = boundary(10, type, "Hautes-Alpes", 44.2, 5.4, 45.1, 7.1)
    val gapEmbrun = boundary(11, type, "Gap-Embrun", 44.2, 5.4, 45.1, 7.1)
    assertThat(containingIdsOf(trail, hautesAlpes, gapEmbrun)).containsExactly(10L, 11L)
  }

  // Only a covering fully holding the trail makes a boundary a candidate, so a lone candidate stays
  // even when the sampled vertices mostly miss its polygon.
  @Test
  fun testLoneCandidateIsKept() {
    val trail =
        trailThrough(
            S2LatLng.fromDegrees(45.0, 6.9),
            S2LatLng.fromDegrees(45.0, 7.1),
            S2LatLng.fromDegrees(45.0, 7.2))
    assertThat(containingIdsOf(trail, france)).containsExactly(1L)
  }
}

private fun containingIdsOf(trail: Trail, vararg boundaries: Boundary): List<Long> {
  val samples = ArrayList<Pair<Long, Pair<Long, List<Long>>>>()
  SampleTrailsForBoundaries().act(
      PEntry(trail.relationId, listOf(Pair(listOf(trail), boundaries.map { it.id }))),
      object : Emitter2<Long, Pair<Long, List<Long>>> {
        override fun emit(a: Long, b: Pair<Long, List<Long>>) {
          samples.add(Pair(a, b))
        }
      })

  val counts = ArrayList<Pair<Boundary, Int>>()
  for (boundary in boundaries) {
    val sent = samples.filter { it.first == boundary.id }.map { it.second }
    CountSamplesInBoundaries().act(
        PEntry(boundary.id, listOf(Pair(listOf(boundary), sent))),
        object : Emitter2<Long, Pair<Boundary, Int>> {
          override fun emit(a: Long, b: Pair<Boundary, Int>) {
            assertThat(a).isEqualTo(trail.relationId)
            counts.add(b)
          }
        })
  }

  val ids = ArrayList<Long>()
  ResolveContainingBoundaries().act(
      PEntry(trail.relationId, counts),
      object : Emitter2<Long, Boundary> {
        override fun emit(a: Long, b: Boundary) {
          ids.add(b.id)
        }
      })
  return ids
}
