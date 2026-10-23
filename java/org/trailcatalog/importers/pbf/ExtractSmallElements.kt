package org.trailcatalog.importers.pbf

import com.google.common.reflect.TypeToken
import crosby.binary.Osmformat.PrimitiveBlock
import org.trailcatalog.importers.pipeline.PTransformer
import org.trailcatalog.importers.pipeline.collections.Emitter
import org.trailcatalog.models.RelationCategory

/** The outputs of one element that are small enough to keep on disk, each null if it has none. */
data class SmallElement(
    val tags: SourceTags?,
    val point: Point?,
    val relation: Relation?,
    val climbing: ClimbingElement?,
)

/**
 * Extracts every output small enough to keep on disk in one pass, because reading the PBF costs far
 * more than keeping a few GB around. Way tags are 25 GB and ExtractNodes and ExtractWays emit every
 * element in the planet, so those keep passes of their own.
 */
class ExtractSmallElements
  : PTransformer<PrimitiveBlock, SmallElement>(TypeToken.of(SmallElement::class.java)) {

  override fun act(input: PrimitiveBlock, emitter: Emitter<SmallElement>) {
    val stringTable = input.stringtable
    forEachNode(input) { id, kvs, latLng, version ->
      val point = nodePoint(id, pointCategory(kvs, stringTable), kvs, latLng, stringTable)
      val climbing = climbingNode(id, kvs, latLng, stringTable)
      if (point != null || climbing != null) {
        emitter.emit(
            SmallElement(nodeSourceTags(id, kvs, version, stringTable), point, null, climbing))
      }
    }

    for (group in input.primitivegroupList) {
      for (way in group.waysList) {
        // ExtractWayTags keeps their tags, since it already reads every way.
        climbingWay(way, stringTable)?.let { emitter.emit(SmallElement(null, null, null, it)) }
      }

      // Some relations with a category never become a boundary or a trail, which costs a few tag
      // rows and nothing else.
      for (relation in group.relationsList) {
        val category = relationCategory(relation, stringTable)
        val climbing = climbingRelation(relation, stringTable)
        if (category != RelationCategory.ANY || climbing != null) {
          emitter.emit(
              SmallElement(
                  relationSourceTags(relation, stringTable),
                  null,
                  getRelation(relation, category, stringTable),
                  climbing))
        }
      }
    }
  }

  // Epoch 26102100 had 2.3 GB of node and relation tags, and the other outputs about double them.
  // => 2 * 2.3 GB / 100 GB
  override fun estimateRatio(): Double {
    return 0.05
  }
}

/** Picks one kind of output out of [SmallElement]s. */
class PickSmallElements<T : Any>(type: TypeToken<T>, private val pick: (SmallElement) -> T?)
  : PTransformer<SmallElement, T>(type) {

  override fun act(input: SmallElement, emitter: Emitter<T>) {
    pick(input)?.let(emitter::emit)
  }
}
