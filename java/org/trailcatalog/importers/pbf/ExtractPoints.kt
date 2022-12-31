package org.trailcatalog.importers.pbf

import com.google.common.reflect.TypeToken
import crosby.binary.Osmformat.PrimitiveBlock
import crosby.binary.Osmformat.StringTable
import org.trailcatalog.importers.pipeline.PTransformer
import org.trailcatalog.importers.pipeline.collections.Emitter
import org.trailcatalog.models.PointCategory

class ExtractPoints : PTransformer<PrimitiveBlock, Point>(TypeToken.of(Point::class.java)) {

  override fun act(input: PrimitiveBlock, emitter: Emitter<Point>) {
    for (group in input.primitivegroupList) {
      for (node in group.nodesList) {
        val latDegrees = (input.latOffset + input.granularity * node.lat) * NANO
        val lngDegrees = (input.lonOffset + input.granularity * node.lon) * NANO
        val kvs = ArrayList<Int>()
        for (i in 0 until node.keysList.size) {
          kvs.add(node.keysList[i])
          kvs.add(node.valsList[i])
        }
        maybeEmitPoint(
            node.id,
            kvs,
            LatLngE7(latDegrees.toIntE7(), lngDegrees.toIntE7()),
            input.stringtable,
            emitter)
      }

      var denseId = 0L
      var denseLat = 0L
      var denseLon = 0L
      val kvIter =
          group.dense.keysValsList.let {
            if (it.isEmpty()) {
              generateSequence { 0 }
            } else {
              it.asSequence()
            }
          }.iterator()
      for (index in 0 until group.dense.idCount) {
        denseId += group.dense.idList[index]
        denseLat += group.dense.latList[index]
        denseLon += group.dense.lonList[index]

        val latDegrees = (input.latOffset + input.granularity * denseLat) * NANO
        val lngDegrees = (input.lonOffset + input.granularity * denseLon) * NANO
        val kvs = kvIter.takeWhile { it != 0 }.toList()
        maybeEmitPoint(
            denseId,
            kvs,
            LatLngE7(latDegrees.toIntE7(), lngDegrees.toIntE7()),
            input.stringtable,
            emitter)
      }
    }
  }

  override fun estimateRatio(): Double {
    return 0.01
  }
}

private fun maybeEmitPoint(
    id: Long,
    kvs: List<Int>,
    latLng: LatLngE7,
    stringTable: StringTable,
    emitter: Emitter<Point>) {
  var category = PointCategory.ANY
  var name: String? = null
  for (i in 0 until kvs.size step 2) {
    when (stringTable.getS(kvs[i])) {
      AMENITY_BS ->
        category =
            category
                .coerceAtLeast(POINT_AMENITY_CATEGORY_NAMES[stringTable.getS(kvs[i + 1])])
      HIGHWAY_BS ->
        category =
            category
                .coerceAtLeast(POINT_HIGHWAY_CATEGORY_NAMES[stringTable.getS(kvs[i + 1])])
      INFORMATION_BS ->
        category =
            category
                .coerceAtLeast(POINT_INFORMATION_CATEGORY_NAMES[stringTable.getS(kvs[i + 1])])
      LEISURE_BS ->
        category =
            category
                .coerceAtLeast(POINT_LEISURE_CATEGORY_NAMES[stringTable.getS(kvs[i + 1])])
      MOUNTAIN_PASS_BS ->
        category =
            category
                .coerceAtLeast(POINT_MOUNTAIN_PASS_CATEGORY_NAMES[stringTable.getS(kvs[i + 1])])
      NAME_BS ->
        name = stringTable.getS(kvs[i + 1]).toStringUtf8()
      NATURAL_BS ->
        category =
            category
                .coerceAtLeast(POINT_NATURAL_CATEGORY_NAMES[stringTable.getS(kvs[i + 1])])
      TOURISM_BS ->
        category =
            category
                .coerceAtLeast(POINT_TOURISM_CATEGORY_NAMES[stringTable.getS(kvs[i + 1])])
      WATERWAY_BS ->
        category =
            category
                .coerceAtLeast(POINT_WATERWAY_CATEGORY_NAMES[stringTable.getS(kvs[i + 1])])
    }
  }

  if (category != PointCategory.ANY) {
    emitter.emit(Point(id, category.id, name, latLng))
  }
}

private fun <V> Iterator<V>.takeWhile(predicate: (V) -> Boolean): List<V> {
  val matches = ArrayList<V>()
  while (this.hasNext()) {
    val next = this.next()
    if (predicate(next)) {
      matches.add(next)
    } else {
      break
    }
  }
  return matches
}
