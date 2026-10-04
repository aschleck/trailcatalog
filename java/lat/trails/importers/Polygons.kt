package lat.trails.importers

import com.google.common.geometry.S1Angle
import com.google.common.geometry.S2Loop
import com.google.common.geometry.S2Point
import com.google.common.geometry.S2Polygon
import com.google.common.geometry.S2PolygonBuilder
import com.google.common.geometry.S2Projections

/**
 * Builds one polygon from a list of polygons, each a list of closed rings with the exterior first
 * and in either winding.
 */
fun assemblePolygon(polygons: List<List<List<S2Point>>>): S2Polygon {
  val builder = S2PolygonBuilder(S2PolygonBuilder.Options.DIRECTED_UNION)
  for (polygon in polygons) {
    var exterior = true
    for (ring in polygon) {
      // The first and last points are the same
      val loop = S2Loop(ring.drop(1))
      loop.normalize()
      if (!exterior) {
        loop.invert()
      } else {
        exterior = false
      }
      builder.addLoop(loop)
    }
  }

  val snapped = S2Polygon()
  snapped.initToSimplified(
      builder.assemblePolygon(),
      S1Angle.radians(S2Projections.MAX_DIAG.getValue(21) / 2.0 + 1e-15),
      /* snapToCellCenters= */ true)

  val normalized = S2PolygonBuilder()
  normalized.addPolygon(snapped)
  return normalized.assemblePolygon()
}
