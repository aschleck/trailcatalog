package org.trailcatalog.importers.basemap

import com.google.common.geometry.S2CellId
import com.google.common.reflect.TypeToken
import org.trailcatalog.importers.pipeline.PMapTransformer
import org.trailcatalog.importers.pipeline.collections.Emitter2
import org.trailcatalog.importers.pipeline.collections.PEntry

private const val SAMPLES = 32

// Sends each boundary whose covering holds a trail a sample of that trail's vertices, as leaf cell
// ids.
class SampleTrailsForBoundaries
  : PMapTransformer<PEntry<Long, Pair<List<Trail>, List<Long>>>, Long, Pair<Long, List<Long>>>(
    "SampleTrailsForBoundaries",
    TypeToken.of(Long::class.java),
    object : TypeToken<Pair<Long, List<Long>>>() {}) {

  override fun act(
      input: PEntry<Long, Pair<List<Trail>, List<Long>>>,
      emitter: Emitter2<Long, Pair<Long, List<Long>>>) {
    for (value in input.values) {
      if (value.first.isEmpty() || value.second.isEmpty()) {
        continue
      }

      val sample = sampleVertices(value.first[0])
      for (boundary in value.second) {
        emitter.emit(boundary, Pair(input.key, sample))
      }
    }
  }

  // Epoch 26101801 covered 1,582,514 trail boundaries, and a sample is a key, a trail id, and 32
  // cell ids, against a 1.6 GB Trail list.
  // => 1,582,514 * (8 + 8 + 32 * 8) / 1.6 GB = 0.27
  override fun estimateRatio(): Double {
    return 0.27
  }
}

private fun sampleVertices(trail: Trail): List<Long> {
  val count = trail.polyline.numVertices()
  return if (count <= SAMPLES) {
    (0 until count).map { S2CellId.fromPoint(trail.polyline.vertex(it)).id() }
  } else {
    (0 until SAMPLES).map {
      S2CellId.fromPoint(trail.polyline.vertex(it * (count - 1) / (SAMPLES - 1))).id()
    }
  }
}
