package org.trailcatalog.importers.basemap

import com.google.common.reflect.TypeToken
import org.trailcatalog.importers.pbf.Way
import org.trailcatalog.importers.pipeline.PMapTransformer
import org.trailcatalog.importers.pipeline.collections.Emitter2
import org.trailcatalog.importers.pipeline.collections.PEntry

class UpdateWayElevations
  : PMapTransformer<PEntry<Long, Pair<List<Way>, List<Profile>>>, Long, Way>(
    "UpdateWayElevations",
    TypeToken.of(Long::class.java),
    TypeToken.of(Way::class.java),
  ) {

  override fun act(
      input: PEntry<Long, Pair<List<Way>, List<Profile>>>, emitter: Emitter2<Long, Way>) {
    val way = input.values.stream().flatMap { it.first.stream() }.findFirst().orElse(null) ?: return
    val profile =
        input.values.stream().flatMap { it.second.stream() }.findFirst().orElse(null)

    val down = profile?.down?.toFloat() ?: Float.NaN
    val up = profile?.up?.toFloat() ?: Float.NaN

    emitter.emit(
        way.id, Way(way.id, way.version, way.type, down, up, way.points))
  }

  override fun estimateRatio(): Double {
    return 0.5
  }
}
