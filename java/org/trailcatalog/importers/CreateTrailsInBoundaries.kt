package org.trailcatalog.importers

import com.google.common.geometry.S2CellUnion
import com.google.common.reflect.TypeToken
import org.trailcatalog.importers.pipeline.PMapTransformer
import org.trailcatalog.importers.pipeline.collections.Emitter2
import org.trailcatalog.importers.pipeline.collections.PEntry
import java.io.ByteArrayInputStream

class CreateTrailsInBoundaries
  : PMapTransformer<PEntry<Long, Pair<List<BoundaryPolygon>, List<TrailPolyline>>>, Long, Long>(
    "CreateTrailsInBoundaries",
    TypeToken.of(Long::class.java),
    TypeToken.of(Long::class.java),
) {

  override fun act(
      input: PEntry<Long, Pair<List<BoundaryPolygon>, List<TrailPolyline>>>,
      emitter: Emitter2<Long, Long>) {
    val polylines = HashMap<Long, S2CellUnion>().also {
      for (value in input.values) {
        for (trail in value.second) {
          val decoded = ByteArrayInputStream(trail.polyline)
          it[trail.id] = S2CellUnion.decode(decoded)
        }
      }
    }

    if (polylines.isEmpty()) {
      return
    }

    for (value in input.values) {
      for (boundary in value.first) {
        val decoded = ByteArrayInputStream(boundary.polygon)
        val polygon = S2CellUnion.decode(decoded)
        for (trail in value.second) {
          val polyline = polylines[trail.id]!!

          if (polygon.contains(polyline)) {
            emitter.emit(trail.id, boundary.id)
          }
        }
      }
    }
  }
}
