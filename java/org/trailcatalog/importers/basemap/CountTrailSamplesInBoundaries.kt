package org.trailcatalog.importers.basemap

import com.google.common.geometry.S2CellId
import com.google.common.geometry.S2Polygon
import com.google.common.reflect.TypeToken
import org.trailcatalog.importers.pipeline.PMapTransformer
import org.trailcatalog.importers.pipeline.collections.Emitter2
import org.trailcatalog.importers.pipeline.collections.PEntry
import java.io.ByteArrayInputStream

// How many more of each candidate trail's samples fall inside the boundary's polygon than outside.
// FindTrailsInBoundaries tests against coverings, which reach past a border, so a trail near one is
// reported inside the boundaries on both sides.
//
// Grouping by boundary is what makes this cheap. S2Polygon builds an index after a couple dozen
// contains calls, and building it costs far more than decoding, so it only pays off when every
// trail in the boundary shares one polygon.
class CountTrailSamplesInBoundaries
  : PMapTransformer<
      PEntry<Long, Pair<List<Boundary>, List<Pair<Long, List<Long>>>>>, Long, Pair<Boundary, Int>>(
    "CountTrailSamplesInBoundaries",
    TypeToken.of(Long::class.java),
    object : TypeToken<Pair<Boundary, Int>>() {}) {

  override fun act(
      input: PEntry<Long, Pair<List<Boundary>, List<Pair<Long, List<Long>>>>>,
      emitter: Emitter2<Long, Pair<Boundary, Int>>) {
    for (value in input.values) {
      if (value.first.isEmpty() || value.second.isEmpty()) {
        continue
      }

      val boundary = value.first[0]
      val polygon = S2Polygon.decode(ByteArrayInputStream(boundary.s2Polygon))
      // Readers only need the id, type, and name, and the polygon is most of the bytes.
      val stripped =
          Boundary(
              boundary.id,
              boundary.type,
              boundary.cell,
              boundary.name,
              listOf(),
              byteArrayOf(),
              boundary.areaMeters2)
      for ((trail, sample) in value.second) {
        val inside = sample.count { polygon.contains(S2CellId(it).toPoint()) }
        emitter.emit(trail, Pair(stripped, 2 * inside - sample.size))
      }
    }
  }

  // Epoch 26101801 covered 1,582,514 trail boundaries. A stripped boundary and its count are about
  // 60 bytes, against 470 MB of boundaries and 430 MB of samples.
  // => 1,582,514 * 60 / 900 MB = 0.1
  override fun estimateRatio(): Double {
    return 0.1
  }
}
