package org.trailcatalog.importers

import com.google.common.reflect.TypeToken
import org.trailcatalog.importers.pipeline.PMapTransformer
import org.trailcatalog.importers.pipeline.collections.Emitter2
import org.trailcatalog.importers.pipeline.collections.PEntry

class CreateTrailsInBoundaries
  : PMapTransformer<PEntry<Long, Pair<List<BoundaryPolygon>, List<TrailPolyline>>>, Long, Long>(
    "CreateTrailsInBoundaries",
    TypeToken.of(Long::class.java),
    TypeToken.of(Long::class.java),
) {

  override fun act(
      input: PEntry<Long, Pair<List<BoundaryPolygon>, List<TrailPolyline>>>,
      emitter: Emitter2<Long, Long>) {
    for (value in input.values) {
      for (boundary in value.first) {
        for (trail in value.second) {
          var found = true
          // TODO(april): should we allow partial containment? Seems slow.
          for (vertex in trail.polyline.vertices()) {
            if (!boundary.polygon.contains(vertex)) {
              found = false
              break
            }
          }

          if (found) {
            emitter.emit(trail.id, boundary.id)
          }
        }
      }
    }
  }
}
