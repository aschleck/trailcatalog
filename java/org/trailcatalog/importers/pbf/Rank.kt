package org.trailcatalog.importers.pbf

import com.google.common.geometry.S2LatLng
import com.google.common.geometry.S2Point
import com.google.common.geometry.S2Polygon
import kotlin.math.PI
import kotlin.math.ceil
import kotlin.math.cos
import kotlin.math.log2
import kotlin.math.pow
import kotlin.math.sqrt
import org.trailcatalog.models.AREA_RELATION_CATEGORIES
import org.trailcatalog.models.PARK_POINT_CATEGORIES
import org.trailcatalog.models.PointCategory
import org.trailcatalog.s2.SimpleS2

private const val LABEL_SIDE_PX = 32.0

// See camera.ts#worldRadiusAt
private const val WORLD_PX_AT_ZOOM_0 = 256.0

// The map styles end at zoom 31
private const val DEEPEST_ZOOM = 31.0

private const val PEOPLE_PER_METER2 = 1000.0 / 1_000_000.0

private const val PEAK_SIDE_PER_PROMINENCE = 10.0

// The largest rank a node of each kind gets, which is the rank of one with no population or
// prominence
private val NODE_RANK_CEILINGS =
    mapOf(
        PointCategory.PLACE_COUNTRY to 4,
        PointCategory.PLACE_STATE to 6,
        PointCategory.PLACE_CITY to 9,
        PointCategory.PLACE_TOWN to 11,
        PointCategory.PLACE_VILLAGE to 13,
        PointCategory.PLACE_SUBURB to 13,
        PointCategory.PLACE_NEIGHBOURHOOD to 14,
        PointCategory.NATURAL_BAY to 10,
        PointCategory.NATURAL_STRAIT to 10,
        PointCategory.NATURAL_PEAK to 13,
        PointCategory.NATURAL_VOLCANO to 13,
    )

val AREA_TYPES =
    (AREA_RELATION_CATEGORIES.keys + PARK_POINT_CATEGORIES.values).map { it.id }.toSet()

/**
 * Returns the rank of an area, as the zoom from which a square with [polygon]'s area spans
 * LABEL_SIDE_PX at [at].
 */
fun getAreaRank(polygon: S2Polygon, at: S2Point): Int {
  return getRank(polygon.area, S2LatLng(at).latRadians())
}

/**
 * Returns the rank of a node, as if it were an area, and never past its kind's ceiling, or null if
 * its kind isn't ranked. A place's [magnitude] is its population, which it holds at
 * PEOPLE_PER_METER2, and a peak's is its prominence in meters, PEAK_SIDE_PER_PROMINENCE times which
 * is the side of a square.
 */
fun getNodeRank(category: PointCategory, magnitude: Double?, at: LatLngE7): Int? {
  val ceiling = NODE_RANK_CEILINGS[category] ?: return null
  if (magnitude == null || magnitude <= 0) {
    return ceiling
  }
  val meters2 =
      if (PointCategory.PLACE.isParentOf(category)) {
        magnitude / PEOPLE_PER_METER2
      } else {
        (PEAK_SIDE_PER_PROMINENCE * magnitude).pow(2)
      }
  val radius = SimpleS2.EARTH_RADIUS_METERS.toDouble()
  val steradians = meters2 / (radius * radius)
  return minOf(ceiling, getRank(steradians, at.toS2LatLng().latRadians()))
}

private fun getRank(steradians: Double, latRadians: Double): Int {
  // The world is 2 * pi radians wide in mercator and WORLD_PX_AT_ZOOM_0 * 2^z pixels wide, and
  // mercator stretches the square's side of sqrt(area) radians by 1 / cos(lat), so
  // sqrt(area) / cos(lat) * WORLD_PX_AT_ZOOM_0 * 2^z / (2 * pi) = LABEL_SIDE_PX
  // => 2^z = 2 * pi * LABEL_SIDE_PX * cos(lat) / (WORLD_PX_AT_ZOOM_0 * sqrt(area))
  val zoom =
      log2(2 * PI * LABEL_SIDE_PX * cos(latRadians) / (WORLD_PX_AT_ZOOM_0 * sqrt(steradians)))
  return ceil(zoom).coerceIn(0.0, DEEPEST_ZOOM).toInt()
}
