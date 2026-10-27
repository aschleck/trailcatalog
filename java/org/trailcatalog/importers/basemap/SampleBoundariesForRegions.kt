package org.trailcatalog.importers.basemap

import com.google.common.geometry.S2CellId
import com.google.common.geometry.S2Polygon
import com.google.common.reflect.TypeToken
import org.trailcatalog.importers.pipeline.PMapTransformer
import org.trailcatalog.importers.pipeline.collections.Emitter2
import org.trailcatalog.importers.pipeline.collections.PEntry
import org.trailcatalog.models.RelationCategory
import java.io.ByteArrayInputStream

private const val SAMPLES = 32

private fun isRegion(type: Int): Boolean {
  return RelationCategory.BOUNDARY_ADMINISTRATIVE_2.isParentOf(type)
      || RelationCategory.BOUNDARY_ADMINISTRATIVE_4.isParentOf(type)
}

// Keeps the boundary pairs whose parent is a country or a state, keyed by the child.
class FilterRegionParents
  : PMapTransformer<PEntry<Long, Pair<List<Boundary>, List<Long>>>, Long, Long>(
    "FilterRegionParents", TypeToken.of(Long::class.java), TypeToken.of(Long::class.java)) {

  override fun act(
      input: PEntry<Long, Pair<List<Boundary>, List<Long>>>, emitter: Emitter2<Long, Long>) {
    for (value in input.values) {
      if (value.first.isEmpty() || !isRegion(value.first[0].type)) {
        continue
      }

      for (child in value.second) {
        emitter.emit(child, input.key)
      }
    }
  }

  // Epoch 26102500 had 1,932,391 country and state pairs, each an 8 byte key and an 8 byte parent,
  // against 470 MB of boundaries.
  // => 1,932,391 * 16 / 470 MB = 0.07
  override fun estimateRatio(): Double {
    return 0.07
  }
}

// Sends each country and state whose covering holds a boundary a sample of that boundary's
// vertices, as leaf cell ids.
class SampleBoundariesForRegions
  : PMapTransformer<PEntry<Long, Pair<List<Boundary>, List<Long>>>, Long, Pair<Long, List<Long>>>(
    "SampleBoundariesForRegions",
    TypeToken.of(Long::class.java),
    object : TypeToken<Pair<Long, List<Long>>>() {}) {

  override fun act(
      input: PEntry<Long, Pair<List<Boundary>, List<Long>>>,
      emitter: Emitter2<Long, Pair<Long, List<Long>>>) {
    for (value in input.values) {
      if (value.first.isEmpty() || value.second.isEmpty()) {
        continue
      }

      val polygon = S2Polygon.decode(ByteArrayInputStream(value.first[0].s2Polygon))
      val sample = sampleVertices(polygon)
      for (region in value.second) {
        emitter.emit(region, Pair(input.key, sample))
      }
    }
  }

  // Epoch 26102500 had 1,932,391 country and state pairs, and a sample is a key, a boundary id, and
  // 32 cell ids, against 470 MB of boundaries.
  // => 1,932,391 * (8 + 8 + 32 * 8) / 470 MB = 1.1
  override fun estimateRatio(): Double {
    return 1.1
  }
}

private fun sampleVertices(polygon: S2Polygon): List<Long> {
  val count = polygon.numVertices
  val picks =
      if (count <= SAMPLES) {
        (0 until count).toList()
      } else {
        (0 until SAMPLES).map { it * (count - 1) / (SAMPLES - 1) }
      }

  // The picks count vertices across every loop in order, so walk the loops alongside them.
  val cells = ArrayList<Long>(picks.size)
  var loop = 0
  var loopStart = 0
  for (pick in picks) {
    while (pick >= loopStart + polygon.loop(loop).numVertices()) {
      loopStart += polygon.loop(loop).numVertices()
      loop += 1
    }
    cells.add(S2CellId.fromPoint(polygon.loop(loop).vertex(pick - loopStart)).id())
  }
  return cells
}
