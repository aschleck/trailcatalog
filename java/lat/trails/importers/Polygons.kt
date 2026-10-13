package lat.trails.importers

import com.google.common.geometry.S1Angle
import com.google.common.geometry.S2Builder
import com.google.common.geometry.S2BuilderSnapFunctions.IdentitySnapFunction
import com.google.common.geometry.S2EdgeUtil
import com.google.common.geometry.S2Error
import com.google.common.geometry.S2Point
import com.google.common.geometry.S2Polygon
import com.google.common.geometry.S2PolygonBuilder
import com.google.common.geometry.S2PolygonLayer
import com.google.common.geometry.S2Projections

/**
 * Builds one polygon from a list of polygons, each a list of closed rings in any order and
 * winding.
 */
fun assemblePolygon(polygons: List<List<List<S2Point>>>): S2Polygon {
  // Parts can touch or overlap, and S2PolygonBuilder's DIRECTED_UNION turns loops inside out when
  // they do.
  val union = S2Polygon.union(polygons.map { assemblePart(it) })

  val snapped = S2Polygon()
  snapped.initToSimplified(
      union,
      S1Angle.radians(S2Projections.MAX_DIAG.getValue(21) / 2.0 + 1e-15),
      /* snapToCellCenters= */ true)

  val normalized = S2PolygonBuilder()
  normalized.addPolygon(snapped)
  return normalized.assemblePolygon()
}

// Builds one polygon from its closed rings by splitting them where they cross and keeping whatever
// an odd number of them encloses, the way renderers fill them. Sources don't reliably put the
// exterior first or keep holes inside it, and S2Loop.normalize can't orient a ring that crosses
// itself, so trusting either turns parts inside out.
private fun assemblePart(rings: List<List<S2Point>>): S2Polygon {
  val builder =
      S2Builder.Builder(IdentitySnapFunction(S1Angle.radians(S2EdgeUtil.INTERSECTION_ERROR)))
          .setSplitCrossingEdges(true)
          .build()
  val layer = S2PolygonLayer(S2PolygonLayer.Options(S2Builder.EdgeType.UNDIRECTED))
  builder.startLayer(layer)
  // A ring that collapses to nothing leaves no edges, and that means empty rather than full.
  builder.addIsFullPolygonPredicate { false }
  for (ring in rings) {
    // The first and last points are the same
    builder.addLoop(ring.dropLast(1))
  }

  val error = S2Error()
  if (!builder.build(error)) {
    throw IllegalArgumentException("Unable to build polygon: $error")
  }
  return layer.polygon
}
