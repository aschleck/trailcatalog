package org.trailcatalog.importers.basemap

import com.google.common.truth.Truth.assertThat
import org.junit.Test
import org.trailcatalog.importers.pbf.Name
import org.trailcatalog.importers.pipeline.collections.Emitter2
import org.trailcatalog.importers.pipeline.collections.PEntry
import org.trailcatalog.models.RelationCategory.BOUNDARY_ADMINISTRATIVE_2
import org.trailcatalog.models.RelationCategory.BOUNDARY_ADMINISTRATIVE_4
import org.trailcatalog.models.RelationCategory.BOUNDARY_ADMINISTRATIVE_6
import org.trailcatalog.models.RelationCategory.BOUNDARY_PROTECTED_AREA_2

class CreateReadableBoundaryIdsTest {

  private val unitedStates =
      boundary(148838, BOUNDARY_ADMINISTRATIVE_2.id, "United States", 24.0, -125.0, 49.0, -66.0)
  private val canada =
      boundary(1428125, BOUNDARY_ADMINISTRATIVE_2.id, "Canada", 41.0, -141.0, 83.0, -52.0)
  private val washington =
      boundary(165479, BOUNDARY_ADMINISTRATIVE_4.id, "Washington", 45.5, -124.8, 49.0, -116.9)
  private val rainier =
      boundary(
          1399219,
          BOUNDARY_PROTECTED_AREA_2.id,
          "Mount Rainier National Park",
          46.7,
          -121.9,
          47.0,
          -121.5)

  @Test
  fun testParkLeadsWithCountryAndState() {
    assertThat(readableIdOf(rainier, listOf(unitedStates, washington)))
        .isEqualTo("united-states/washington/mount-rainier-national-park")
  }

  @Test
  fun testStateLeadsWithCountry() {
    assertThat(readableIdOf(washington, listOf(unitedStates)))
        .isEqualTo("united-states/washington")
  }

  @Test
  fun testCountryIgnoresOtherCountries() {
    assertThat(readableIdOf(canada, listOf(unitedStates))).isEqualTo("canada")
  }

  @Test
  fun testStateIgnoresOtherStates() {
    val idaho = boundary(162116, BOUNDARY_ADMINISTRATIVE_4.id, "Idaho", 42.0, -117.2, 49.0, -111.0)
    assertThat(readableIdOf(washington, listOf(unitedStates, idaho)))
        .isEqualTo("united-states/washington")
  }

  @Test
  fun testCountyLeadsWithCountryAndState() {
    val pierce =
        boundary(1155955, BOUNDARY_ADMINISTRATIVE_6.id, "Pierce County", 46.7, -122.9, 47.4, -121.4)
    assertThat(readableIdOf(pierce, listOf(unitedStates, washington)))
        .isEqualTo("united-states/washington/pierce-county")
  }

  // Coverings reach past a border, so FindBoundariesInBoundaries reports a park near one as
  // contained by both sides.
  @Test
  fun testParkNearABorderIsOnlyInTheCountryItIsIn() {
    val type = BOUNDARY_ADMINISTRATIVE_2.id
    val south = boundary(148838, type, "United States", 45.0, -121.0, 49.0, -119.0)
    val north = boundary(1428125, type, "Canada", 49.0, -121.0, 53.0, -119.0)
    val vaseux =
        boundary(
            3500000,
            BOUNDARY_PROTECTED_AREA_2.id,
            "Vaseux Protected Area",
            49.2,
            -119.6,
            49.3,
            -119.5)
    assertThat(readableIdOf(vaseux, regionsOf(vaseux, south, north)))
        .isEqualTo("canada/vaseux-protected-area")
  }

  @Test
  fun testEnglishNamesLead() {
    val schweiz =
        boundary(
            51701,
            BOUNDARY_ADMINISTRATIVE_2.id,
            "Schweiz/Suisse/Svizzera/Svizra",
            45.8,
            5.9,
            47.8,
            10.5,
            names = listOf(Name("en", "Switzerland"), Name(null, "Schweiz/Suisse/Svizzera/Svizra")))
    val bern =
        boundary(
            1686344,
            BOUNDARY_ADMINISTRATIVE_4.id,
            "Bern/Berne",
            46.3,
            6.8,
            47.4,
            8.5,
            names = listOf(Name(null, "Bern"), Name(null, "Bern/Berne")))
    val hohgant =
        boundary(17405555, BOUNDARY_PROTECTED_AREA_2.id, "Hohgant", 46.7, 7.8, 46.8, 7.9)
    assertThat(readableIdOf(hohgant, listOf(schweiz, bern))).isEqualTo("switzerland/bern/hohgant")
  }

  @Test
  fun testSlashesBetweenLanguagesBecomeDashes() {
    val schweiz =
        boundary(
            51701,
            BOUNDARY_ADMINISTRATIVE_2.id,
            "Schweiz/Suisse/Svizzera/Svizra",
            46.0,
            6.0,
            47.0,
            10.0)
    assertThat(readableIdOf(schweiz, listOf())).isEqualTo("schweiz-suisse-svizzera-svizra")
  }

  @Test
  fun testHyphensStayAsDashes() {
    val baselStadt =
        boundary(1690227, BOUNDARY_ADMINISTRATIVE_4.id, "Basel-Stadt", 47.5, 7.5, 47.6, 7.7)
    assertThat(readableIdOf(baselStadt, listOf())).isEqualTo("basel-stadt")
  }

  @Test
  fun testMissingRegionsAreOmitted() {
    assertThat(readableIdOf(rainier, listOf())).isEqualTo("mount-rainier-national-park")
  }
}

private fun regionsOf(boundary: Boundary, vararg candidates: Boundary): List<Boundary> {
  val samples = ArrayList<Pair<Long, Pair<Long, List<Long>>>>()
  SampleBoundariesForRegions().act(
      PEntry(boundary.id, listOf(Pair(listOf(boundary), candidates.map { it.id }))),
      object : Emitter2<Long, Pair<Long, List<Long>>> {
        override fun emit(a: Long, b: Pair<Long, List<Long>>) {
          samples.add(Pair(a, b))
        }
      })

  val counts = ArrayList<Pair<Boundary, Int>>()
  for (candidate in candidates) {
    val sent = samples.filter { it.first == candidate.id }.map { it.second }
    CountSamplesInBoundaries().act(
        PEntry(candidate.id, listOf(Pair(listOf(candidate), sent))),
        object : Emitter2<Long, Pair<Boundary, Int>> {
          override fun emit(a: Long, b: Pair<Boundary, Int>) {
            counts.add(b)
          }
        })
  }

  val regions = ArrayList<Boundary>()
  ResolveContainingBoundaries().act(
      PEntry(boundary.id, counts),
      object : Emitter2<Long, Boundary> {
        override fun emit(a: Long, b: Boundary) {
          regions.add(b)
        }
      })
  return regions
}

private fun readableIdOf(boundary: Boundary, regions: List<Boundary>): String {
  val ids = ArrayList<String>()
  CreateReadableBoundaryIds().act(
      PEntry(boundary.id, listOf(Pair(listOf(boundary), regions))),
      object : Emitter2<String, Long> {
        override fun emit(a: String, b: Long) {
          ids.add(a)
        }
      })
  assertThat(ids).hasSize(1)
  return ids[0]
}
