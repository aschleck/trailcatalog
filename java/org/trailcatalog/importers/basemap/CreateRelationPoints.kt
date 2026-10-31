package org.trailcatalog.importers.basemap

import com.google.common.reflect.TypeToken
import org.trailcatalog.importers.pbf.LatLngE7
import org.trailcatalog.importers.pbf.Point
import org.trailcatalog.importers.pbf.Relation
import org.trailcatalog.importers.pbf.interiorPoint
import org.trailcatalog.importers.pipeline.PTransformer
import org.trailcatalog.importers.pipeline.collections.Emitter
import org.trailcatalog.importers.pipeline.collections.PEntry
import org.trailcatalog.models.AREA_RELATION_CATEGORIES
import org.trailcatalog.models.relationPointId
import org.trailcatalog.proto.RelationGeometry

private val POINT_CATEGORIES =
    AREA_RELATION_CATEGORIES.entries.associate { (point, relation) -> relation.id to point }

/**
 * Collapses each glacier and lake multipolygon to a point inside it, the way MakeWayPoints does
 * the ones drawn as a single way.
 */
class CreateRelationPoints
  : PTransformer<PEntry<Long, Pair<List<Relation>, List<RelationGeometry>>>, Point>(
    TypeToken.of(Point::class.java)) {

  override fun act(
      input: PEntry<Long, Pair<List<Relation>, List<RelationGeometry>>>,
      emitter: Emitter<Point>) {
    val (relations, geometries) = input.values[0]
    if (relations.isEmpty() || geometries.isEmpty()) {
      return
    }
    val relation = relations[0]
    val category = POINT_CATEGORIES[relation.type] ?: return

    val polygon = relationGeometryToPolygon(geometries[0])
    if (polygon.isEmpty) {
      return
    }
    // Relations don't carry notable, which only costs them search's small bonus for a Wikidata
    // link.
    emitter.emit(
        Point(
            relationPointId(relation.id),
            category.id,
            relation.name.ifEmpty { null },
            relation.names,
            /* notable= */ false,
            LatLngE7.fromS2Point(interiorPoint(polygon))))
  }

  // Glaciers and lakes are a small share of the relations we keep.
  override fun estimateRatio(): Double {
    return 0.1
  }
}
