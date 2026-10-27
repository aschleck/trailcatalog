package org.trailcatalog.importers.basemap

import com.google.common.reflect.TypeToken
import org.trailcatalog.importers.pipeline.PMapTransformer
import org.trailcatalog.importers.pipeline.collections.Emitter2
import org.trailcatalog.importers.pipeline.collections.PEntry

class CreateReadableBoundaryIds :
    PMapTransformer<PEntry<Long, Pair<List<Boundary>, List<Boundary>>>, String, Long>(
    "CreateReadableBoundaryIds", TypeToken.of(String::class.java), TypeToken.of(Long::class.java)) {

  override fun act(
      input: PEntry<Long, Pair<List<Boundary>, List<Boundary>>>,
      emitter: Emitter2<String, Long>) {
    for (value in input.values) {
      if (value.first.isEmpty()) {
        continue
      }

      val boundary = value.first[0]
      val parts =
          getRegionPrefix(value.second, boundary.type) +
              getReadableName(boundary.names, boundary.name)
      emitter.emit(parts.joinToString("/") { toReadableId(it) }, input.key)
    }
  }

  // Epoch 26102500 had 866,710 boundaries, and an id is about 40 bytes of text and an 8 byte
  // boundary id, against 470 MB of boundaries.
  // => 866,710 * 48 / 470 MB = 0.09
  override fun estimateRatio(): Double {
    return 0.09
  }
}
