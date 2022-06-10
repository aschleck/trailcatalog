package org.trailcatalog.importers

import com.google.common.geometry.S2Polygon
import com.google.common.geometry.S2PolygonBuilder
import com.google.common.geometry.S2PolygonBuilder.Options
import com.google.common.reflect.TypeToken
import org.trailcatalog.importers.pbf.Relation
import org.trailcatalog.importers.pipeline.PTransformer
import org.trailcatalog.importers.pipeline.collections.Emitter
import org.trailcatalog.importers.pipeline.collections.PEntry
import org.trailcatalog.models.RelationCategory.BOUNDARY
import org.trailcatalog.proto.RelationGeometry
import org.trailcatalog.s2.boundToCell
import java.io.ByteArrayOutputStream

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
    val cell = boundToCell(polygon.rectBound).id()
    emitter.emit(Boundary(relation.id, relation.type, cell, relation.name, encoded.toByteArray()))
  }
}

private fun relationGeometryToPolygon(geometry: RelationGeometry): S2Polygon {
  val polygon = S2PolygonBuilder(Options.UNDIRECTED_XOR)
  expandIntoPolygon(geometry, polygon)
  return polygon.assemblePolygon()
}

private fun expandIntoPolygon(geometry: RelationGeometry, polygon: S2PolygonBuilder) {
  for (member in geometry.membersList) {
    // TODO(april): consider inner vs outer
    if (member.hasRelation()) {
      expandIntoPolygon(member.relation, polygon)
    } else if (member.hasWay()) {
      val latLngs = member.way.latLngE7List
      for (i in 0 until latLngs.size - 2 step 2) {
        polygon.addEdge(e7ToS2(latLngs[i], latLngs[i + 1]), e7ToS2(latLngs[i + 2], latLngs[i + 3]))
      }
    }
  }
}