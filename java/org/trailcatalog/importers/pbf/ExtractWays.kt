package org.trailcatalog.importers.pbf

import com.google.common.reflect.TypeToken
import com.google.protobuf.ByteString
import crosby.binary.Osmformat
import crosby.binary.Osmformat.PrimitiveBlock
import crosby.binary.Osmformat.StringTable
import org.trailcatalog.importers.pipeline.PTransformer
import org.trailcatalog.importers.pipeline.collections.Emitter
import org.trailcatalog.models.PathTrait
import org.trailcatalog.models.PointCategory
import org.trailcatalog.models.WayCategory

class ExtractWays
  : PTransformer<PrimitiveBlock, WaySkeleton>(TypeToken.of(WaySkeleton::class.java)) {

  override fun act(input: PrimitiveBlock, emitter: Emitter<WaySkeleton>) {
    for (group in input.primitivegroupList) {
      for (way in group.waysList) {
        emitter.emit(getWay(way, input.stringtable))
      }
    }
  }

  override fun estimateRatio(): Double {
    return 0.5
  }
}

private fun getWay(way: Osmformat.Way, stringTable: StringTable): WaySkeleton {
  val kvs = wayKvs(way)
  val refs = wayRefs(way)
  val pointCategory = wayPointCategory(kvs, refs, stringTable)
  return WaySkeleton(
      way.id,
      wayCategory(way, stringTable).id,
      wayTraits(way, stringTable),
      tagName(kvs, stringTable) ?: "",
      refs,
      pointCategory.id,
      if (pointCategory == PointCategory.ANY) listOf() else tagNames(kvs, stringTable),
      pointCategory != PointCategory.ANY && isNotable(kvs, stringTable))
}

// Each trait's tag, to its shift and its grades
private val PATH_TRAIT_TAGS: Map<ByteString, Pair<Int, Map<ByteString, Int>>> =
    PathTrait.values().associate { trait ->
      ByteString.copyFromUtf8(trait.tag) to
          Pair(
              trait.shift,
              trait.grades.withIndex().associate { (i, grade) ->
                ByteString.copyFromUtf8(grade) to i + 1
              })
    }

fun wayTraits(way: Osmformat.Way, stringTable: StringTable): Int {
  var traits = 0
  for (i in 0 until way.keysCount) {
    val (shift, grades) = PATH_TRAIT_TAGS[stringTable.getS(way.getKeys(i))] ?: continue
    val grade = grades[stringTable.getS(way.getVals(i))] ?: continue
    traits = traits or (grade shl shift)
  }
  return traits
}

/** Returns the tags of [way] as interleaved key and value string indices. */
fun wayKvs(way: Osmformat.Way): List<Int> {
  val kvs = ArrayList<Int>(2 * way.keysCount)
  for (i in 0 until way.keysCount) {
    kvs.add(way.getKeys(i))
    kvs.add(way.getVals(i))
  }
  return kvs
}

/** Returns the node ids of [way], which the file delta codes. */
fun wayRefs(way: Osmformat.Way): LongArray {
  val refs = LongArray(way.refsCount)
  var nodeId = 0L
  for (i in 0 until way.refsCount) {
    nodeId += way.getRefs(i)
    refs[i] = nodeId
  }
  return refs
}

private fun isClosed(way: Osmformat.Way): Boolean {
  // The refs are delta coded, so the last one is the first one when the rest sum to zero.
  var sum = 0L
  for (i in 1 until way.refsCount) {
    sum += way.getRefs(i)
  }
  return way.refsCount > 1 && sum == 0L
}

fun wayCategory(way: Osmformat.Way, stringTable: StringTable): WayCategory {
  var category = WayCategory.ANY
  // construction=*, footway=*, and service=* each name a subtype of whatever the way already is, so
  // they can only be resolved once every other tag has been read. service=* also appears on
  // highway=service, where it means something else.
  var construction: ByteString? = null
  var footway: ByteString? = null
  var service: ByteString? = null
  // A highway=* on a lift or a piste says there's ground to walk on, so it has to beat categories
  // that outrank it, like PISTE_DOWNHILL over PATH, whichever order the tags come in.
  var highway: WayCategory? = null
  var landuse = false
  var railway: WayCategory? = null
  for (i in 0 until way.keysCount) {
    when (stringTable.getS(way.getKeys(i))) {
      AERIALWAY_BS ->
        category =
            category
                .coerceAtLeast(WayCategory.AERIALWAY)
                .coerceAtLeast(AERIALWAY_CATEGORY_NAMES[stringTable.getS(way.getVals(i))])
      AEROWAY_BS ->
        category =
            category
                .coerceAtLeast(WayCategory.AEROWAY)
                .coerceAtLeast(AEROWAY_CATEGORY_NAMES[stringTable.getS(way.getVals(i))])
      MAN_MADE_BS ->
        // Only the linear ones, or else every storage tank lands in the table.
        category =
            category.coerceAtLeast(MAN_MADE_CATEGORY_NAMES[stringTable.getS(way.getVals(i))])
      CONSTRUCTION_BS ->
        construction = stringTable.getS(way.getVals(i))
      FOOTWAY_BS ->
        footway = stringTable.getS(way.getVals(i))
      SERVICE_BS ->
        service = stringTable.getS(way.getVals(i))
      WATERWAY_BS ->
        // Only the linear ones, so that a dock or a boatyard area stays out.
        category =
            category.coerceAtLeast(WATERWAY_CATEGORY_NAMES[stringTable.getS(way.getVals(i))])
      ROUTE_BS ->
        // Prefer anything to routes
        if (WayCategory.ANY == category) {
          category =
              category
                  .coerceAtLeast(ROUTE_WAY_CATEGORY_NAMES[stringTable.getS(way.getVals(i))])
        }
      HIGHWAY_BS -> {
        highway =
            WayCategory.HIGHWAY
                .coerceAtLeast(HIGHWAY_CATEGORY_NAMES[stringTable.getS(way.getVals(i))])
        category = category.coerceAtLeast(highway)
      }
      NATURAL_BS ->
        // Prefer road categories to naturals
        if (!WayCategory.ROAD.isParentOf(category)) {
          category =
              category
                  .coerceAtLeast(WayCategory.NATURAL)
                  .coerceAtLeast(NATURAL_WAY_CATEGORY_NAMES[stringTable.getS(way.getVals(i))])
        }
      PISTE_TYPE_BS ->
        category =
            category
                .coerceAtLeast(WayCategory.PISTE)
                .coerceAtLeast(PISTE_CATEGORY_NAMES[stringTable.getS(way.getVals(i))])
      LANDUSE_BS ->
        landuse = true
      RAILWAY_BS ->
        railway = RAILWAY_CATEGORY_NAMES[stringTable.getS(way.getVals(i))]
    }
  }
  // A closed way with landuse=* is the outline of railroad land, like way 883999185, and its
  // railway=* describes the line inside it. An open one is track with a stray landuse=railway, like
  // way 284787416.
  if (railway != null && !(landuse && isClosed(way))) {
    category = category.coerceAtLeast(railway)
  }
  if (highway != null
      && (WayCategory.AERIALWAY.isParentOf(category) || WayCategory.PISTE.isParentOf(category))) {
    category = highway
  }
  // Only a way that stayed at plain rail, so that a siding tag can't overwrite a tram or a subway.
  if (service != null && category == WayCategory.RAIL) {
    category = category.coerceAtLeast(RAIL_SERVICE_CATEGORY_NAMES[service])
  }
  if (construction != null && category == WayCategory.ROAD_CONSTRUCTION) {
    category = category.coerceAtLeast(ROAD_CONSTRUCTION_CATEGORY_NAMES[construction])
  }
  // Only a way that stayed at plain footway, so a sidewalk tag can't pull a cycleway or a set of
  // steps out from under its own category.
  if (footway != null && category == WayCategory.PATH_FOOTWAY) {
    category = category.coerceAtLeast(FOOTWAY_CATEGORY_NAMES[footway])
  }
  return category
}
