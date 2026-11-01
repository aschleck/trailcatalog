package org.trailcatalog.importers.basemap

import com.google.common.reflect.TypeToken
import org.trailcatalog.importers.pbf.Way
import org.trailcatalog.importers.pbf.wayBoundaryId
import org.trailcatalog.importers.pipeline.PTransformer
import org.trailcatalog.importers.pipeline.collections.Emitter
import org.trailcatalog.importers.pipeline.collections.PEntry
import org.trailcatalog.models.RelationCategory

/** Makes a boundary of each closed way with a boundary type, the way CreateBoundaries does. */
class MakeWayBoundaries
  : PTransformer<PEntry<Long, Way>, Boundary>(TypeToken.of(Boundary::class.java)) {

  override fun act(input: PEntry<Long, Way>, emitter: Emitter<Boundary>) {
    val way = input.values[0]
    val point = way.point ?: return
    if (point.boundaryType == RelationCategory.ANY.id) {
      return
    }

    makeBoundary(wayBoundaryId(way.id), point.boundaryType, point.name, point.names) {
      closedWayToPolygon(way)
    }?.let(emitter::emit)
  }

  // Only parks emit, and they're a sliver of the ways with geometry.
  override fun estimateRatio(): Double {
    return 0.01
  }
}
