package org.trailcatalog.importers.pbf

import com.google.common.geometry.S2CellId
import com.google.common.geometry.S2Point
import com.google.common.geometry.S2Polyline
import com.google.common.reflect.TypeToken
import org.trailcatalog.importers.pipeline.PMapTransformer
import org.trailcatalog.importers.pipeline.collections.Emitter2
import org.trailcatalog.importers.pipeline.collections.PEntry

private const val NODE_SNAP_CELL_LEVEL = 24

class MakeWayGeometries
  : PMapTransformer<PEntry<Long, Pair<List<WaySkeleton>, List<Node>>>, Long, Way>(
    "MakeWayGeometries",
    TypeToken.of(Long::class.java),
    TypeToken.of(Way::class.java),
  ) {

  override fun act(
      input: PEntry<Long, Pair<List<WaySkeleton>, List<Node>>>, emitter: Emitter2<Long, Way>) {
    val way = input.values.stream().flatMap { it.first.stream() }.findFirst().orElse(null) ?: return

    val mapped = HashMap<Long, LatLngE7>()
    for (value in input.values) {
      for (node in value.second) {
        mapped[node.id] = node.latLng
      }
    }

    val geometry = ArrayList<S2Point>()
    var lastCell = S2CellId(0)
    for (node in way.nodes) {
      val cell =
          S2CellId.fromLatLng((mapped[node] ?: return).toS2LatLng()).parent(NODE_SNAP_CELL_LEVEL)
      if (cell != lastCell) {
        geometry.add(cell.toPoint())
        lastCell = cell
      }
    }
    emitter.emit(way.id, Way(way.id, way.version, way.type, way.name, S2Polyline(geometry)))
  }

  override fun estimateRatio(): Double {
    return 0.5
  }
}
