package org.trailcatalog.importers.basemap

import com.google.common.geometry.S2LatLng
import com.google.common.geometry.S2LatLngRect
import com.google.common.geometry.S2Loop
import com.google.common.geometry.S2Polygon
import com.google.common.geometry.S2Polyline
import com.google.common.truth.Truth.assertThat
import java.io.ByteArrayOutputStream
import org.junit.Test
import org.trailcatalog.importers.pipeline.collections.Emitter2
import org.trailcatalog.importers.pipeline.collections.PEntry
import org.trailcatalog.models.RelationCategory.BOUNDARY_ADMINISTRATIVE_2
import org.trailcatalog.models.RelationCategory.TRAIL

class CreateReadableTrailIdsTest {

  // Крым is mapped inside both Україна and Россия.
  @Test
  fun testTrailInTwoCountriesTakesTheLowerId() {
    val trail = trailThrough(S2LatLng.fromDegrees(44.5, 34.2), S2LatLng.fromDegrees(44.6, 34.3))
    val ukraine = boundary(60199, BOUNDARY_ADMINISTRATIVE_2.id, "Україна", 44.0, 33.0, 46.0, 36.0)
    val russia = boundary(60189, BOUNDARY_ADMINISTRATIVE_2.id, "Россия", 44.0, 33.0, 46.0, 36.0)

    assertThat(readableIdOf(trail, listOf(ukraine, russia))).isEqualTo("россия/none/col")
    assertThat(readableIdOf(trail, listOf(russia, ukraine))).isEqualTo("россия/none/col")
  }

  @Test
  fun testTrailInNoBoundaryIsNone() {
    val trail = trailThrough(S2LatLng.fromDegrees(45.0, 6.9), S2LatLng.fromDegrees(45.1, 6.95))
    assertThat(readableIdOf(trail, listOf())).isEqualTo("none/none/col")
  }
}

internal fun trailThrough(vararg points: S2LatLng): Trail {
  return Trail(
      1,
      TRAIL.id,
      "Col",
      listOf(),
      longArrayOf(),
      S2Polyline(points.map { it.toPoint() }),
      /* downMeters= */ 0f,
      /* upMeters= */ 0f,
      /* lengthMeters= */ 0f,
      /* validGeometry= */ true)
}

internal fun boundary(
    id: Long,
    type: Int,
    name: String,
    lowLat: Double,
    lowLng: Double,
    highLat: Double,
    highLng: Double): Boundary {
  val rect =
      S2LatLngRect.fromPointPair(
          S2LatLng.fromDegrees(lowLat, lowLng), S2LatLng.fromDegrees(highLat, highLng))
  val polygon = S2Polygon(S2Loop((0 until 4).map { rect.getVertex(it).toPoint() }))
  val encoded = ByteArrayOutputStream().also { polygon.encode(it) }
  return Boundary(id, type, 0, name, listOf(), encoded.toByteArray(), 0.0)
}

private fun readableIdOf(trail: Trail, boundaries: List<Boundary>): String {
  val ids = ArrayList<String>()
  CreateReadableTrailIds().act(
      PEntry(trail.relationId, listOf(Pair(listOf(trail), boundaries))),
      object : Emitter2<String, Long> {
        override fun emit(a: String, b: Long) {
          ids.add(a)
        }
      })
  assertThat(ids).hasSize(1)
  return ids[0]
}
