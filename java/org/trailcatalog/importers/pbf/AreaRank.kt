package org.trailcatalog.importers.pbf

import com.google.common.geometry.S2LatLng
import com.google.common.geometry.S2Point
import com.google.common.geometry.S2Polygon
import kotlin.math.PI
import kotlin.math.ceil
import kotlin.math.cos
import kotlin.math.log2
import kotlin.math.sqrt
import org.trailcatalog.models.AREA_RELATION_CATEGORIES
import org.trailcatalog.models.PARK_POINT_CATEGORIES

private const val LABEL_SIDE_PX = 32.0

// See camera.ts#worldRadiusAt
private const val WORLD_PX_AT_ZOOM_0 = 256.0

// The map styles end at zoom 31
private const val DEEPEST_ZOOM = 31.0

val AREA_TYPES =
    (AREA_RELATION_CATEGORIES.keys + PARK_POINT_CATEGORIES.values).map { it.id }.toSet()

/**
 * Returns the rank of an area, as the zoom from which a square with [polygon]'s area spans
 * LABEL_SIDE_PX at [at].
 */
fun getAreaRank(polygon: S2Polygon, at: S2Point): Int {
  // The world is 2 * pi radians wide in mercator and WORLD_PX_AT_ZOOM_0 * 2^z pixels wide, and
  // mercator stretches the square's side of sqrt(area) radians by 1 / cos(lat), so
  // sqrt(area) / cos(lat) * WORLD_PX_AT_ZOOM_0 * 2^z / (2 * pi) = LABEL_SIDE_PX
  // => 2^z = 2 * pi * LABEL_SIDE_PX * cos(lat) / (WORLD_PX_AT_ZOOM_0 * sqrt(area))
  val cosLat = cos(S2LatLng(at).latRadians())
  val zoom = log2(2 * PI * LABEL_SIDE_PX * cosLat / (WORLD_PX_AT_ZOOM_0 * sqrt(polygon.area)))
  return ceil(zoom).coerceIn(0.0, DEEPEST_ZOOM).toInt()
}
