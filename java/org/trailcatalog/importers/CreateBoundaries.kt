package org.trailcatalog.importers

import com.google.common.geometry.S1Angle
import com.google.common.geometry.S2CellId
import com.google.common.geometry.S2Loop
import com.google.common.geometry.S2Polygon
import com.google.common.geometry.S2PolygonBuilder
import com.google.common.geometry.S2PolygonBuilder.Options
import com.google.common.geometry.S2Projections
import com.google.common.reflect.TypeToken
import java.io.ByteArrayOutputStream
import org.trailcatalog.importers.pbf.Relation
import org.trailcatalog.importers.pipeline.PTransformer
import org.trailcatalog.importers.pipeline.collections.Emitter
import org.trailcatalog.importers.pipeline.collections.PEntry
import org.trailcatalog.models.RelationCategory.BOUNDARY
import org.trailcatalog.proto.RelationGeometry
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

    val polygon = relationGeometryToPolygon(geometries[0])
    val encoded = ByteArrayOutputStream().also {
      polygon.encode(it)
    }
    val cell = polygonToCell(polygon).id()
    if (cell == S2CellId.fromFace(0).id()) {
      println(relation.id)
    }
    emitter.emit(Boundary(relation.id, relation.type, cell, relation.name, encoded.toByteArray()))
  }
}

private fun relationGeometryToPolygon(geometry: RelationGeometry): S2Polygon {
  val loops = ArrayList<S2Loop>()
  expandIntoPolygon(geometry, loops)
  val unsnapped = S2Polygon(loops)

  val snapped = S2Polygon()
  snapped.initToSimplified(
      unsnapped,
      S1Angle.radians(S2Projections.PROJ.maxDiag.getValue(21) / 2.0 + 1e-15),
      /* snapToCellCenters= */ true)
  return snapped
}

private fun expandIntoPolygon(
    geometry: RelationGeometry,
    loops: MutableList<S2Loop>) {
  val us = S2PolygonBuilder(Options.UNDIRECTED_UNION)
  for (member in geometry.membersList) {
    // TODO(april): consider inner vs outer
    if (member.hasWay()) {
      val latLngs = member.way.latLngE7List
      for (i in 0 until latLngs.size - 2 step 2) {
        us.addEdge(e7ToS2(latLngs[i], latLngs[i + 1]), e7ToS2(latLngs[i + 2], latLngs[i + 3]))
      }
    }
  }
  val ourLoops = ArrayList<S2Loop>()
  us.assembleLoops(ourLoops, /* unusedEdges= */ null)
  for (loop in ourLoops) {
    if (loop.isHole()) {
      loop.invert()
    }

    var contained = false
    for (other in loops) {
      if (other.contains(loop)) {
        contained = true
        break
      }
    }

    if (!contained) {
      loops.add(loop)
    }
  }

  for (member in geometry.membersList) {
    // TODO(april): consider inner vs outer
    if (member.hasRelation()) {
      expandIntoPolygon(member.relation, loops)
    }
  }
}
