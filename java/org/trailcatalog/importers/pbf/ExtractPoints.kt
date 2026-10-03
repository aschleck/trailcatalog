package org.trailcatalog.importers.pbf

import com.google.common.reflect.TypeToken
import crosby.binary.Osmformat.PrimitiveBlock
import crosby.binary.Osmformat.StringTable
import org.trailcatalog.importers.pipeline.PTransformer
import org.trailcatalog.importers.pipeline.collections.Emitter
import org.trailcatalog.models.PointCategory

class ExtractPoints : PTransformer<PrimitiveBlock, Point>(TypeToken.of(Point::class.java)) {

  override fun act(input: PrimitiveBlock, emitter: Emitter<Point>) {
    forEachNode(input) { id, kvs, latLng, _ ->
      val category = pointCategory(kvs, input.stringtable)
      if (category != PointCategory.ANY) {
        emitter.emit(Point(id, category.id, nodeName(kvs, input.stringtable), latLng))
      }
    }
  }

  override fun estimateRatio(): Double {
    return 0.01
  }
}

/**
 * Calls [fn] with every node in [block], its tags as interleaved key and value string indices, and
 * its version when the file carries one.
 */
fun forEachNode(
    block: PrimitiveBlock,
    fn: (id: Long, kvs: List<Int>, latLng: LatLngE7, version: Int?) -> Unit) {
  for (group in block.primitivegroupList) {
    for (node in group.nodesList) {
      val latDegrees = (block.latOffset + block.granularity * node.lat) * NANO
      val lngDegrees = (block.lonOffset + block.granularity * node.lon) * NANO
      val kvs = ArrayList<Int>()
      for (i in 0 until node.keysList.size) {
        kvs.add(node.keysList[i])
        kvs.add(node.valsList[i])
      }
      fn(
          node.id,
          kvs,
          LatLngE7(latDegrees.toIntE7(), lngDegrees.toIntE7()),
          if (node.hasInfo()) node.info.version else null)
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
    // Unlike the ids and coordinates, DenseInfo versions are not delta coded.
    val versions = group.dense.denseinfo.versionList
    for (index in 0 until group.dense.idCount) {
      denseId += group.dense.idList[index]
      denseLat += group.dense.latList[index]
      denseLon += group.dense.lonList[index]

      val latDegrees = (block.latOffset + block.granularity * denseLat) * NANO
      val lngDegrees = (block.lonOffset + block.granularity * denseLon) * NANO
      fn(
          denseId,
          kvIter.takeWhile { it != 0 }.toList(),
          LatLngE7(latDegrees.toIntE7(), lngDegrees.toIntE7()),
          if (index < versions.size) versions[index] else null)
    }
  }
}

fun pointCategory(kvs: List<Int>, stringTable: StringTable): PointCategory {
  var category = PointCategory.ANY
  var tower = false
  var observation = false
  for (i in 0 until kvs.size step 2) {
    val value = stringTable.getS(kvs[i + 1])
    when (stringTable.getS(kvs[i])) {
      AMENITY_BS -> category = category.coerceAtLeast(POINT_AMENITY_CATEGORY_NAMES[value])
      EMERGENCY_BS -> category = category.coerceAtLeast(POINT_EMERGENCY_CATEGORY_NAMES[value])
      HIGHWAY_BS -> category = category.coerceAtLeast(POINT_HIGHWAY_CATEGORY_NAMES[value])
      HISTORIC_BS -> category = category.coerceAtLeast(POINT_HISTORIC_CATEGORY_NAMES[value])
      INFORMATION_BS -> category = category.coerceAtLeast(POINT_INFORMATION_CATEGORY_NAMES[value])
      LEISURE_BS -> category = category.coerceAtLeast(POINT_LEISURE_CATEGORY_NAMES[value])
      MAN_MADE_BS -> {
        category = category.coerceAtLeast(POINT_MAN_MADE_CATEGORY_NAMES[value])
        tower = value == TOWER_BS
      }
      MOUNTAIN_PASS_BS ->
        category = category.coerceAtLeast(POINT_MOUNTAIN_PASS_CATEGORY_NAMES[value])
      NATURAL_BS -> category = category.coerceAtLeast(POINT_NATURAL_CATEGORY_NAMES[value])
      RAILWAY_BS -> category = category.coerceAtLeast(POINT_RAILWAY_CATEGORY_NAMES[value])
      SHOP_BS -> category = category.coerceAtLeast(POINT_SHOP_CATEGORY_NAMES[value])
      TOURISM_BS -> category = category.coerceAtLeast(POINT_TOURISM_CATEGORY_NAMES[value])
      TOWER_TYPE_BS -> observation = value == OBSERVATION_BS
      WATERWAY_BS -> category = category.coerceAtLeast(POINT_WATERWAY_CATEGORY_NAMES[value])
    }
  }
  if (tower && observation) {
    category = category.coerceAtLeast(PointCategory.SIGHT_OBSERVATION_TOWER)
  }
  return category
}

private fun nodeName(kvs: List<Int>, stringTable: StringTable): String? {
  for (i in 0 until kvs.size step 2) {
    if (stringTable.getS(kvs[i]) == NAME_BS) {
      return stringTable.getS(kvs[i + 1]).toStringUtf8()
    }
  }
  return null
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
