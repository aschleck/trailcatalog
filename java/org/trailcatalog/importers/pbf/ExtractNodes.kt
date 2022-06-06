package org.trailcatalog.importers.pbf

import com.google.common.reflect.TypeToken
import crosby.binary.Osmformat.PrimitiveBlock
import org.trailcatalog.importers.pipeline.PSortedTransformer
import org.trailcatalog.importers.pipeline.collections.Emitter

class ExtractNodes : PSortedTransformer<PrimitiveBlock, Node>(TypeToken.of(Node::class.java)) {

  override fun act(input: PrimitiveBlock, emitter: Emitter<Node>) {
    for (group in input.primitivegroupList) {
      for (node in group.nodesList) {
        val latDegrees = (input.latOffset + input.granularity * node.lat) * NANO
        val lngDegrees = (input.lonOffset + input.granularity * node.lon) * NANO
        emitter.emit(Node(node.id, LatLngE7(latDegrees.toIntE7(), lngDegrees.toIntE7())))
      }

      var denseId = 0L
      var denseLat = 0L
      var denseLon = 0L
      for (index in 0 until group.dense.idCount) {
        denseId += group.dense.idList[index]
        denseLat += group.dense.latList[index]
        denseLon += group.dense.lonList[index]

        val latDegrees = (input.latOffset + input.granularity * denseLat) * NANO
        val lngDegrees = (input.lonOffset + input.granularity * denseLon) * NANO
        emitter.emit(Node(denseId, LatLngE7(latDegrees.toIntE7(), lngDegrees.toIntE7())))
      }
    }
  }

  override fun estimateRatio(): Double {
    return 2.0
  }
}

fun Double.toIntE7(): Int {
  return (this * 10_000_000).toInt()
}