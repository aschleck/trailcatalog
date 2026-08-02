package org.trailcatalog.importers.basemap

import com.google.common.geometry.S1Angle
import com.google.common.geometry.S2CellId
import com.google.common.geometry.S2Loop
import com.google.common.geometry.S2Polygon
import com.google.common.geometry.S2PolygonBuilder
import com.google.common.geometry.S2PolygonBuilder.Options
import com.google.common.geometry.S2Projections
import com.google.common.reflect.TypeToken
import java.io.ByteArrayOutputStream
import kotlin.math.PI
import org.trailcatalog.importers.pbf.Relation
import org.trailcatalog.importers.pipeline.PTransformer
import org.trailcatalog.importers.pipeline.collections.Emitter
import org.trailcatalog.importers.pipeline.collections.PEntry
import org.trailcatalog.models.RelationCategory.BOUNDARY
import org.trailcatalog.proto.RelationGeometry
import org.trailcatalog.proto.RelationMemberFunction.INNER
import org.trailcatalog.s2.earthSteradiansToMeters2
import org.trailcatalog.s2.polygonToCell

class CreateBoundaries
  : PTransformer<PEntry<Long, Pair<List<Relation>, List<RelationGeometry>>>, Boundary>(
    TypeToken.of(Boundary::class.java)) {

  override fun act(
      input: PEntry<Long, Pair<List<Relation>, List<RelationGeometry>>>,
      emitter: Emitter<Boundary>) {
    val (relations, geometries) = input.values[0]
    if (relations.isEmpty() || geometries.isEmpty()) {
      return
    }

    val relation = relations[0]
    // Avoid timezones and other nonsense
    if (relation.type == BOUNDARY.id) {
      return
    }
    if (relation.name.isNullOrBlank()) {
      return
    }
    if (!BOUNDARY.isParentOf(relation.type)) {
      return
    }

    val polygon = try {
        relationGeometryToPolygon(geometries[0])
    } catch (e: NullPointerException) {
        throw RuntimeException("Error creating the boundary for ${relation.id} - ${relation.name}", e)
    }
    val encoded = ByteArrayOutputStream().also {
      polygon.encode(it)
    }
    val cell = polygonToCell(polygon).id()
    if (cell == S2CellId.fromFace(0).id()) {
      println(relation.id)
    }
    emitter.emit(
        Boundary(
            relation.id,
            relation.type,
            cell,
            relation.name,
            relation.names,
            encoded.toByteArray(),
            earthSteradiansToMeters2(polygon.area)))
  }
}

// Half the level 21 cell diagonal, so a vertex snapped to a cell center moves by at most this.
private val SNAP_RADIUS = S1Angle.radians(S2Projections.MAX_DIAG.getValue(21) / 2.0 + 1e-15)

// Ways meeting at a corner miss each other by a fraction of a meter often enough that assembled
// rings cross themselves. The robustness radius merges vertices closer than 2 * SNAP_RADIUS over
// the 0.866 edge splice fraction, and splices a vertex into any edge within 2 * SNAP_RADIUS, so
// those corners become one vertex before they can cross. That leaves only the crossings that are
// real, such as بلدية النسيم's western edge doubling back over itself for a kilometer.
//
// snapToCellCenters stays off because it moves each vertex of an assembled ring to its own cell
// center, which crosses two edges of a ring only a few cells wide. initToSimplified snaps through
// S2Builder, which keeps the topology.
private val ASSEMBLE_OPTIONS =
    Options.UNDIRECTED_UNION.toBuilder()
        .setRobustnessRadius(SNAP_RADIUS)
        .build()

private fun relationGeometryToPolygon(geometry: RelationGeometry): S2Polygon {
  val outers = ArrayList<S2Loop>()
  val inners = ArrayList<S2Loop>()
  expandIntoPolygon(geometry, outers, inners)

  // Saddle Mountains East is one BLM way tagged inner with nothing to be inner to. A relation with
  // no outer ring has its roles wrong rather than no area, and the rings it does have are the
  // area the mapper drew.
  if (outers.isEmpty()) {
    outers.addAll(inners)
    inners.clear()
  }

  // A relation's rings are the pieces of one area, not a nesting hierarchy: Custer Gallatin
  // National Forest lists one of its rings twice, and two coincident rings are neither nested nor
  // disjoint, so S2Polygon of them is invalid and initToSimplified hands back its complement.
  //
  // Roles say which rings are holes, so gmina Bełchatów keeps the town of Bełchatów out of itself.
  val unsnapped = S2Polygon()
  unsnapped.initToDifference(
      S2Polygon.union(outers.map { S2Polygon(it) }),
      S2Polygon.union(inners.map { S2Polygon(it) }))

  val snapped = S2Polygon()
  snapped.initToSimplified(unsnapped, SNAP_RADIUS, /* snapToCellCenters= */ true)
  return snapped
}

private fun expandIntoPolygon(
    geometry: RelationGeometry,
    outers: MutableList<S2Loop>,
    inners: MutableList<S2Loop>) {
  val outerBuilder = S2PolygonBuilder(ASSEMBLE_OPTIONS)
  val innerBuilder = S2PolygonBuilder(ASSEMBLE_OPTIONS)
  for (member in geometry.membersList) {
    if (member.hasWay()) {
      val into = if (member.function == INNER) innerBuilder else outerBuilder
      val latLngs = member.way.latLngE7List
      for (i in 0 until latLngs.size - 2 step 2) {
        into.addEdge(e7ToS2(latLngs[i], latLngs[i + 1]), e7ToS2(latLngs[i + 2], latLngs[i + 3]))
      }
    }
  }

  for ((builder, into) in listOf(outerBuilder to outers, innerBuilder to inners)) {
    val assembled = ArrayList<S2Loop>()
    try {
      builder.assembleLoops(assembled, /* unusedEdges= */ null)
    } catch (_: StackOverflowError) {
      println("Unable to assemble ${geometry.getRelationId()}")
      continue
    }

    for (loop in assembled) {
      // union and initToDifference run on S2BooleanOperation, which requires valid input and only
      // checks it through an assert, so a ring that crosses itself reaches
      // CrossingProcessor#doneBoundaryPair and dies on a sourceIdMap entry that was never added. A
      // ring we drop costs that relation its area, which beats a crash or a whole sphere polygon.
      //
      // We check here rather than through S2PolygonBuilder's validate option because that option
      // checks a ring where assembleLoop builds it, and the options that run after it can leave a
      // ring that passed crossing itself.
      if (!loop.isValid()) {
        continue
      }

      // S2PolygonBuilder orients a ring by its turning angle, and the two windings of a ring that
      // crosses itself cancel to zero, which reads as counterclockwise, so a clockwise ring comes
      // back enclosing everything outside itself. No administrative boundary or protected area
      // covers half the Earth, so area says which side is the interior when the turning angle
      // can't.
      if (loop.area > 2 * PI) {
        loop.invert()
      }

      into.add(loop)
    }
  }

  for (member in geometry.membersList) {
    if (member.hasRelation()) {
      // An inner member's own outers cut the hole and its inners give the hole back.
      if (member.function == INNER) {
        expandIntoPolygon(member.relation, inners, outers)
      } else {
        expandIntoPolygon(member.relation, outers, inners)
      }
    }
  }
}
