package org.trailcatalog.importers.pbf

import com.google.common.reflect.TypeToken
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

fun getWay(way: Osmformat.Way, stringTable: StringTable): WaySkeleton {
  var category = WayCategory.ANY
  var name: String? = null
  for (i in 0 until way.keysCount) {
    when (stringTable.getS(way.getKeys(i))) {
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
          category = category.coerceAtLeast(WayCategory.PATH)
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
        category = category.coerceAtLeast(WayCategory.HIGHWAY)
    }
  }
  val refs = LongArray(way.refsCount)
  var nodeId = 0L
  for (i in 0 until way.refsCount) {
    nodeId += way.getRefs(i)
    refs[i] = nodeId
  }
  return WaySkeleton(way.id, category.id, name ?: "", refs)
}
