package org.trailcatalog.importers.pbf

import com.google.common.reflect.TypeToken
import crosby.binary.Osmformat.PrimitiveBlock
import crosby.binary.Osmformat.StringTable
import org.trailcatalog.importers.pipeline.PTransformer
import org.trailcatalog.importers.pipeline.collections.Emitter
import org.trailcatalog.models.PointCategory

// The categories whose names are worth searching, and the only ones a way becomes a point for.
// Bus stops, convenience stores, supermarkets, fuel, and pharmacies are mostly chains or street
// names, guide posts, parking, ruins, toilets, and camp pitches are mostly numbers or
// descriptions, and shelters are mostly bus stops and picnic roofs.
private val SEARCHABLE_POINT_CATEGORIES =
    setOf(
        PointCategory.ACCESS_TRAILHEAD,
        PointCategory.ACCESS_TRANSIT_AIRPORT,
        PointCategory.ACCESS_TRANSIT_FERRY_TERMINAL,
        PointCategory.ACCESS_TRANSIT_STATION,
        PointCategory.CLIMBING_ROUTE,
        PointCategory.INFORMATION_RANGER_STATION,
        PointCategory.INFORMATION_VISITOR_CENTER,
        PointCategory.LODGING_CAMP_CARAVAN_SITE,
        PointCategory.LODGING_CAMP_SITE,
        PointCategory.LODGING_HOSTEL,
        PointCategory.LODGING_HUT_ALPINE,
        PointCategory.LODGING_HUT_WILDERNESS,
        PointCategory.LODGING_ROOM_CHALET,
        PointCategory.LODGING_ROOM_GUEST_HOUSE,
        PointCategory.LODGING_ROOM_HOTEL,
        PointCategory.LODGING_ROOM_MOTEL,
        PointCategory.NATURAL_CAVE_ENTRANCE,
        PointCategory.NATURAL_HOT_SPRING,
        PointCategory.NATURAL_MOUNTAIN_PASS,
        PointCategory.NATURAL_PEAK,
        PointCategory.NATURAL_SADDLE,
        PointCategory.NATURAL_VOLCANO,
        PointCategory.NATURAL_WATERFALL,
        PointCategory.SAFETY_CLINIC,
        PointCategory.SAFETY_MOUNTAIN_RESCUE,
        PointCategory.SIGHT_OBSERVATION_TOWER,
        PointCategory.SIGHT_VIEWPOINT,
        PointCategory.WATER_SPRING,
        PointCategory.WATER_TAP,
    )

/** Returns the point a node with [category] becomes, or null if it isn't one. */
fun nodePoint(
    id: Long,
    category: PointCategory,
    kvs: List<Int>,
    latLng: LatLngE7,
    stringTable: StringTable): Point? {
  if (category == PointCategory.ANY) {
    return null
  }
  val names =
      if (category in SEARCHABLE_POINT_CATEGORIES) {
        tagNames(kvs, stringTable)
      } else {
        listOf()
      }
  return Point(
      nodePointId(id),
      category.id,
      tagName(kvs, stringTable),
      names,
      isNotable(kvs, stringTable),
      latLng)
}

// Node and way ids overlap, so a point's id carries which one it came from in its low bit. Keep in
// sync with types.ts#Point and viewer_controller.ts#osmElementOf.
fun nodePointId(nodeId: Long): Long = 2 * nodeId

fun wayPointId(wayId: Long): Long = 2 * wayId + 1

/**
 * Returns the point category of a closed way or a climbing route that should also become a point,
 * or [PointCategory.ANY].
 */
fun wayPointCategory(kvs: List<Int>, nodes: LongArray, stringTable: StringTable): PointCategory {
  val category = pointCategory(kvs, stringTable)
  // A route is drawn from its bottom to its top, so it needn't be closed.
  // https://wiki.openstreetmap.org/wiki/Tag:climbing%3Droute
  if (category == PointCategory.CLIMBING_ROUTE) {
    return category
  }
  if (nodes.size < 4 || nodes[0] != nodes[nodes.size - 1]) {
    return PointCategory.ANY
  }
  return if (category in SEARCHABLE_POINT_CATEGORIES) category else PointCategory.ANY
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
      AEROWAY_BS -> category = category.coerceAtLeast(POINT_AEROWAY_CATEGORY_NAMES[value])
      AMENITY_BS -> category = category.coerceAtLeast(POINT_AMENITY_CATEGORY_NAMES[value])
      CLIMBING_BS -> category = category.coerceAtLeast(POINT_CLIMBING_CATEGORY_NAMES[value])
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

fun tagName(kvs: List<Int>, stringTable: StringTable): String? {
  for (i in 0 until kvs.size step 2) {
    if (stringTable.getS(kvs[i]) == NAME_BS) {
      return stringTable.getS(kvs[i + 1]).toStringUtf8()
    }
  }
  return null
}

// Only the element's own links count, because brand:wikidata names a chain and every one of its
// stores carries it.
fun isNotable(kvs: List<Int>, stringTable: StringTable): Boolean {
  for (i in 0 until kvs.size step 2) {
    val key = stringTable.getS(kvs[i])
    if (key == WIKIDATA_BS || key == WIKIPEDIA_BS || key.startsWith(WIKIPEDIA_PREFIX_BS)) {
      return true
    }
  }
  return false
}

fun tagNames(kvs: List<Int>, stringTable: StringTable): List<Name> {
  val names = NameCollector()
  for (i in 0 until kvs.size step 2) {
    names.add(stringTable.getS(kvs[i]), stringTable.getS(kvs[i + 1]))
  }
  return names.toList()
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
