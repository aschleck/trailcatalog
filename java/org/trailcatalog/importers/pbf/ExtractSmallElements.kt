package org.trailcatalog.importers.pbf

import com.google.common.reflect.TypeToken
import crosby.binary.Osmformat.PrimitiveBlock
import org.trailcatalog.importers.pipeline.PTransformer
import org.trailcatalog.importers.pipeline.collections.Emitter

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
      val category = pointCategory(kvs, stringTable)
      emitIfAny(
          emitter,
          nodeSourceTags(id, category, kvs, version, stringTable),
          nodePoint(id, category, kvs, latLng, stringTable),
          null,
          climbingNode(id, kvs, latLng, stringTable))
    }

    for (group in input.primitivegroupList) {
      for (way in group.waysList) {
        climbingWay(way, stringTable)?.let { emitter.emit(SmallElement(null, null, null, it)) }
      }

      for (relation in group.relationsList) {
        val category = relationCategory(relation, stringTable)
        emitIfAny(
            emitter,
            relationSourceTags(relation, category, stringTable),
            null,
            getRelation(relation, category, stringTable),
            climbingRelation(relation, stringTable))
      }
    }
  }

  // Epoch 26102100 had 2.3 GB of node and relation tags, and the other outputs about double them.
  // => 2 * 2.3 GB / 100 GB
  override fun estimateRatio(): Double {
    return 0.05
  }
}

private fun emitIfAny(
    emitter: Emitter<SmallElement>,
    tags: SourceTags?,
    point: Point?,
    relation: Relation?,
    climbing: ClimbingElement?) {
  if (tags != null || point != null || relation != null || climbing != null) {
    emitter.emit(SmallElement(tags, point, relation, climbing))
  }
}

/** Picks one kind of output out of [SmallElement]s. */
class PickSmallElements<T : Any>(type: TypeToken<T>, private val pick: (SmallElement) -> T?)
  : PTransformer<SmallElement, T>(type) {

  override fun act(input: SmallElement, emitter: Emitter<T>) {
    pick(input)?.let(emitter::emit)
  }
}
