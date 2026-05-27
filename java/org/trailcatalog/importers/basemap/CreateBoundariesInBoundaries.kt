package org.trailcatalog.importers.basemap

import com.google.common.geometry.S2CellUnion
import com.google.common.reflect.TypeToken
import org.trailcatalog.importers.pipeline.PMapTransformer
import org.trailcatalog.importers.pipeline.collections.Emitter2
import org.trailcatalog.importers.pipeline.collections.PEntry
import java.io.ByteArrayInputStream

class CreateBoundariesInBoundaries
  : PMapTransformer<PEntry<Long, Pair<List<BoundaryPolygon>, List<TrailPolyline>>>, Long, Long>(
    "CreateBoundariesInBoundaries",
    TypeToken.of(Long::class.java),
    TypeToken.of(Long::class.java),
) {

  // Per hot cell, materializes a HashMap of every boundary's decoded S2CellUnion and runs an
  // O(N^2) containment check. Running N copies in parallel multiplies that resident set —
  // OOMs in practice. Keep single-threaded until the algorithm is rewritten for bounded memory.
  override val parallelism: Int = 1

  override fun act(
      input: PEntry<Long, Pair<List<BoundaryPolygon>, List<TrailPolyline>>>,
      emitter: Emitter2<Long, Long>) {
    val count = input.values.map { it.first.count() }.sum()
    if (count <= 1) {
      return
    }

    val polygons = HashMap<Long, S2CellUnion>().also {
      for (value in input.values) {
        for (boundary in value.first) {
          val decoded = ByteArrayInputStream(boundary.polygon)
          it[boundary.id] = S2CellUnion.decode(decoded)
        }
      }
    }

    for (value in input.values) {
      for (child in value.first) {
        for (parent in value.first) {
          if (child.id == parent.id) {
            continue
          }

          if (polygons[parent.id]!!.contains(polygons[child.id]!!)) {
            emitter.emit(child.id, parent.id)
          }
        }
      }
    }
  }
}
