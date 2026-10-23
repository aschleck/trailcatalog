package org.trailcatalog.importers.basemap

import com.google.common.geometry.S2ConvexHullQuery
import com.google.common.geometry.S2Loop
import com.google.common.geometry.S2Polygon
import com.google.common.reflect.TypeToken
import java.io.ByteArrayOutputStream
import org.trailcatalog.importers.pbf.ClimbingElement
import org.trailcatalog.importers.pbf.LatLngE7
import org.trailcatalog.importers.pbf.Way
import org.trailcatalog.importers.pbf.nodeSiteId
import org.trailcatalog.importers.pbf.siteWayId
import org.trailcatalog.importers.pbf.waySiteId
import org.trailcatalog.importers.pipeline.PStage
import org.trailcatalog.importers.pipeline.collections.DisposableSupplier
import org.trailcatalog.importers.pipeline.collections.PCollection
import org.trailcatalog.importers.pipeline.collections.PList
import org.trailcatalog.importers.pipeline.collections.PMap
import org.trailcatalog.importers.pipeline.collections.createPList
import org.trailcatalog.models.RelationCategory
import org.trailcatalog.proto.RelationSkeletonMember.ValueCase.NODE_ID
import org.trailcatalog.proto.RelationSkeletonMember.ValueCase.RELATION_ID
import org.trailcatalog.proto.RelationSkeletonMember.ValueCase.WAY_ID
import org.trailcatalog.s2.SimpleS2
import org.trailcatalog.s2.earthSteradiansToMeters2
import org.trailcatalog.s2.polygonToCell

private val SITE_RADIUS = SimpleS2.earthMetersToAngle(5.0)

private const val CIRCLE_VERTICES = 16

/** Adds the climbing ways to the member ways, so that GroupWays keeps them for their geometry. */
class AddClimbingWays
  : PStage<Pair<LongBitSet, PCollection<ClimbingElement>>, LongBitSet>() {

  override fun act(
      input: Pair<LongBitSet, PCollection<ClimbingElement>>,
      dependants: Int): DisposableSupplier<LongBitSet> {
    val (members, elements) = input
    elements.use {
      for (element in elements) {
        siteWayId(element.id)?.let(members::add)
      }
    }
    return DisposableSupplier({}) { members }
  }
}

/**
 * Makes a boundary for each climbing area, boulder, and crag from the convex hull of the climbing
 * elements it holds, grown by [SITE_RADIUS] so that a site holding a single point is still a
 * circle. A site drawn as a multipolygon has real geometry, so CreateBoundaries makes its boundary
 * instead, see relationCategory. There are few enough climbing elements worldwide to hold them all
 * in memory.
 */
class CreateClimbingSites
  : PStage<Pair<PCollection<ClimbingElement>, PMap<Long, Way>>, PList<Boundary>>() {

  override fun act(
      input: Pair<PCollection<ClimbingElement>, PMap<Long, Way>>,
      dependants: Int): DisposableSupplier<PList<Boundary>> {
    val (elementList, ways) = input
    val elements = HashMap<Long, ClimbingElement>()
    elementList.use {
      for (element in elementList) {
        elements[element.id] = element
      }
    }
    val wayVertices = HashMap<Long, List<LatLngE7>>()
    ways.use {
      for (entry in ways) {
        val way = entry.values[0]
        if (waySiteId(way.id) in elements) {
          wayVertices[waySiteId(way.id)] = way.points
        }
      }
    }

    // There are around 15,000 sites in the world, each a few hundred bytes.
    return createPList(TypeToken.of(Boundary::class.java), 15_000L * 300) { emitter ->
      createClimbingSites(elements, wayVertices).forEach(emitter::emit)
    }
  }
}

/** Returns a boundary for each site in [elements], given the climbing ways' vertices by site id. */
fun createClimbingSites(
    elements: Map<Long, ClimbingElement>,
    wayVertices: Map<Long, List<LatLngE7>>): List<Boundary> {
  val sites = ArrayList<Boundary>()
  for (element in elements.values) {
    if (!RelationCategory.BOUNDARY_CLIMBING.isParentOf(element.type)
        || element.type == RelationCategory.BOUNDARY_CLIMBING.id) {
      continue
    }
    val vertices = ArrayList<LatLngE7>()
    gatherVertices(element, elements, wayVertices, HashSet(), vertices)
    createSite(element, vertices)?.let(sites::add)
  }
  return sites
}

// Members without a climbing tag, like the parking lots and approach paths that sites often list,
// aren't in elements, so they don't stretch the hull.
private fun gatherVertices(
    element: ClimbingElement,
    elements: Map<Long, ClimbingElement>,
    wayVertices: Map<Long, List<LatLngE7>>,
    visited: MutableSet<Long>,
    into: MutableList<LatLngE7>) {
  // A relation can reach another through two paths, or through itself.
  if (!visited.add(element.id)) {
    return
  }
  element.latLng?.let(into::add)
  wayVertices[element.id]?.let(into::addAll)
  for (member in element.members.membersList) {
    val id =
        when (member.valueCase) {
          NODE_ID -> nodeSiteId(member.nodeId)
          RELATION_ID -> member.relationId
          WAY_ID -> waySiteId(member.wayId)
          else -> continue
        }
    elements[id]?.let { gatherVertices(it, elements, wayVertices, visited, into) }
  }
}

private fun createSite(element: ClimbingElement, vertices: List<LatLngE7>): Boundary? {
  // Nameless boundaries are dropped for the same reason as in CreateBoundaries, and a site whose
  // members are all outside the import has nothing to draw.
  if (element.name.isBlank() || vertices.isEmpty()) {
    return null
  }

  // The hull of a circle around every vertex is the hull of the vertices grown by the radius.
  val hull = S2ConvexHullQuery()
  for (vertex in vertices) {
    val circle =
        S2Loop.makeRegularLoop(vertex.toS2LatLng().toPoint(), SITE_RADIUS, CIRCLE_VERTICES)
    for (corner in circle.vertices()) {
      hull.addPoint(corner)
    }
  }
  val polygon = S2Polygon(hull.convexHull)
  val encoded = ByteArrayOutputStream().also { polygon.encode(it) }
  return Boundary(
      element.id,
      element.type,
      polygonToCell(polygon).id(),
      element.name,
      element.names,
      encoded.toByteArray(),
      earthSteradiansToMeters2(polygon.area))
}
