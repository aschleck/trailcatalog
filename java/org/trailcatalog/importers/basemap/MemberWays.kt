package org.trailcatalog.importers.basemap

import com.google.common.reflect.TypeToken
import org.trailcatalog.importers.pbf.Relation
import org.trailcatalog.importers.pbf.WaySkeleton
import org.trailcatalog.importers.pipeline.PStage
import org.trailcatalog.importers.pipeline.collections.DisposableSupplier
import org.trailcatalog.importers.pipeline.collections.PCollection
import org.trailcatalog.importers.pipeline.collections.PMap
import org.trailcatalog.importers.pipeline.collections.createPMap
import org.trailcatalog.models.WayCategory

/** A set of non-negative ids, one bit apiece, growing to the largest id added. */
class LongBitSet {

  // Planet way ids run to around 1.5 billion, so this ends up around 190 MB.
  private var words = LongArray(1024)

  fun add(id: Long) {
    val word = (id ushr 6).toInt()
    if (word >= words.size) {
      words = words.copyOf(maxOf(word + 1, 2 * words.size))
    }
    words[word] = words[word] or (1L shl (id and 63).toInt())
  }

  operator fun contains(id: Long): Boolean {
    val word = (id ushr 6).toInt()
    return word < words.size && words[word] and (1L shl (id and 63).toInt()) != 0L
  }
}

/** Collects the ids of every way that a relation we kept names as a member. */
class CollectMemberWays : PStage<PMap<Long, Relation>, LongBitSet>() {

  override fun act(input: PMap<Long, Relation>, dependants: Int): DisposableSupplier<LongBitSet> {
    val members = LongBitSet()
    input.use {
      for (entry in input) {
        for (relation in entry.values) {
          for (member in relation.skeleton.membersList) {
            if (member.hasWayId()) {
              members.add(member.wayId)
            }
          }
        }
      }
    }
    return DisposableSupplier({}) { members }
  }
}

/**
 * Groups ways by id, dropping the ones that no table wants. DumpPaths skips WayCategory.ANY, and
 * most planet ways are untagged buildings and landuse that are ANY, but a relation's member ways
 * are often untagged too and its geometry needs them.
 */
class GroupWays
  : PStage<Pair<LongBitSet, PCollection<WaySkeleton>>, PMap<Long, WaySkeleton>>() {

  override fun act(
      input: Pair<LongBitSet, PCollection<WaySkeleton>>,
      dependants: Int): DisposableSupplier<PMap<Long, WaySkeleton>> {
    val (members, ways) = input
    return createPMap(
        "GroupWays",
        object : TypeToken<Long>() {},
        TypeToken.of(WaySkeleton::class.java),
        (1.25 * ways.estimatedByteSize()).toLong(),
        ways,
        resolvedParallelism,
        dependants) { way, emitter ->
      if (way.type != WayCategory.ANY.id || way.id in members) {
        emitter.emit(way.id, way)
      }
    }
  }
}
