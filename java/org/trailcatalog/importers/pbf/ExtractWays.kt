package org.trailcatalog.importers.pbf

import com.google.common.reflect.TypeToken
import com.google.protobuf.ByteString
import crosby.binary.Osmformat
import crosby.binary.Osmformat.PrimitiveBlock
import crosby.binary.Osmformat.StringTable
import org.trailcatalog.importers.pipeline.PTransformer
import org.trailcatalog.importers.pipeline.collections.Emitter
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
  var category = WayCategory.ANY
  var name: String? = null
  // construction=* and service=* both name a subtype of whatever the way already is, so they can
  // only be resolved once every other tag has been read. service=* also appears on
  // highway=service, where it means something else.
  var construction: ByteString? = null
  var service: ByteString? = null
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
      HIGHWAY_BS ->
        category =
            category
                .coerceAtLeast(WayCategory.HIGHWAY)
                .coerceAtLeast(HIGHWAY_CATEGORY_NAMES[stringTable.getS(way.getVals(i))])
      NAME_BS ->
        name = stringTable.getS(way.getVals(i)).toStringUtf8()
      NATURAL_BS ->
        // Prefer road categories to naturals
        if (!WayCategory.ROAD.isParentOf(category)) {
          category =
              category
                  .coerceAtLeast(WayCategory.NATURAL)
                  .coerceAtLeast(NATURAL_WAY_CATEGORY_NAMES[stringTable.getS(way.getVals(i))])
        }
      PISTE_TYPE_BS ->
        // Prefer road categories to pistes
        if (!WayCategory.ROAD.isParentOf(category)) {
          category =
              category
                  .coerceAtLeast(WayCategory.PISTE)
                  .coerceAtLeast(PISTE_CATEGORY_NAMES[stringTable.getS(way.getVals(i))])
        }
      RAILWAY_BS ->
        // It seems fun to dump all rails just in case...
        // TODO(april): but do trails really depend on railways?
        category =
            category
                .coerceAtLeast(WayCategory.RAIL)
                .coerceAtLeast(RAILWAY_CATEGORY_NAMES[stringTable.getS(way.getVals(i))])
    }
  }
  // Only a way that stayed at plain rail, so that a siding tag can't overwrite a tram or a subway.
  if (service != null && category == WayCategory.RAIL) {
    category = category.coerceAtLeast(RAIL_SERVICE_CATEGORY_NAMES[service])
  }
  if (construction != null && category == WayCategory.ROAD_CONSTRUCTION) {
    category = category.coerceAtLeast(ROAD_CONSTRUCTION_CATEGORY_NAMES[construction])
  }
  val refs = LongArray(way.refsCount)
  var nodeId = 0L
  for (i in 0 until way.refsCount) {
    nodeId += way.getRefs(i)
    refs[i] = nodeId
  }
  return WaySkeleton(way.id, category.id, name ?: "", refs)
}
