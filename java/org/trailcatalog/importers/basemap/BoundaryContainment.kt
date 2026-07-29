package org.trailcatalog.importers.basemap

import com.google.common.geometry.S2CellId
import com.google.common.geometry.S2CellUnion
import com.google.common.geometry.S2Polygon
import com.google.common.geometry.S2Polyline
import com.google.common.geometry.S2RegionCoverer
import com.google.common.reflect.TypeToken
import org.trailcatalog.importers.pipeline.PStage
import org.trailcatalog.importers.pipeline.collections.DisposableSupplier
import org.trailcatalog.importers.pipeline.collections.PCollection
import org.trailcatalog.importers.pipeline.collections.PMap
import org.trailcatalog.importers.pipeline.collections.createPMap
import org.trailcatalog.importers.pipeline.progress.longProgress
import java.io.ByteArrayInputStream
import java.util.concurrent.Callable
import java.util.concurrent.Executors

private const val SNAP_CELL_LEVEL = 18

// S2RegionCoverer allocates its working state per getCovering call and holds only final ints, so
// one instance serves every worker thread.
private val COVERER =
    S2RegionCoverer.builder().setMaxCells(1000).setMaxLevel(SNAP_CELL_LEVEL).build()

// No real cell id is zero, so it marks a covering that spans more than one face.
private const val NO_ENCLOSING_CELL = 0L

// OSM relation ids are positive, so this skips nothing.
const val NO_SKIP = 0L

// Epoch 260715 wrote 14,868,608 boundary pairs for 839,409 boundaries, so about 18 parents each,
// and a merged record is an 8 byte key, a varint count, and 8 bytes a parent.
// => 8 + 1 + 18 * 8 = 153
private const val BYTES_PER_CHILD_BOUNDARY = 153L

/**
 * Boundary coverings keyed by the smallest cell that encloses each one.
 *
 * A boundary can only contain a covering whose own enclosing cell is a descendant of the
 * boundary's, so a child reaches every candidate by walking its enclosing cell up to the face. See
 * BoundaryIndexTest, which pins that claim and [coveringContains] against S2CellUnion#contains.
 */
class BoundaryIndex(
    private val ids: LongArray,
    private val minLeaves: LongArray,
    private val maxLeaves: LongArray,
    private val coverings: Array<LongArray>,
    private val byEnclosingCell: Map<Long, IntArray>,
    // A covering spanning more than one face has no enclosing cell because the hierarchy has six
    // roots, so every child has to consider these.
    private val multiFace: IntArray,
) {

  val size: Int
    get() = ids.size

  fun id(slot: Int): Long {
    return ids[slot]
  }

  fun covering(slot: Int): LongArray {
    return coverings[slot]
  }

  /**
   * Calls [fn] with the id of every indexed boundary containing [child], other than [skipId] so a
   * boundary is not reported as containing itself.
   */
  fun forEachContaining(child: LongArray, skipId: Long, fn: (Long) -> Unit) {
    if (child.isEmpty()) {
      return
    }

    val childMin = cellRangeMin(child[0])
    val childMax = cellRangeMax(child[child.size - 1])
    var cell = smallestEnclosingCell(child)
    while (cell != null) {
      byEnclosingCell[cell.id()]?.also { test(it, child, childMin, childMax, skipId, fn) }
      cell = if (cell.level() == 0) null else cell.parent()
    }
    test(multiFace, child, childMin, childMax, skipId, fn)
  }

  private fun test(
      slots: IntArray,
      child: LongArray,
      childMin: Long,
      childMax: Long,
      skipId: Long,
      fn: (Long) -> Unit) {
    for (slot in slots) {
      if (ids[slot] == skipId) {
        continue
      }

      // Leaf range containment is necessary for covering containment and rejects nearly every
      // candidate, so it keeps the covering walk off the hot path.
      if (unsignedLessOrEqual(minLeaves[slot], childMin)
          && unsignedLessOrEqual(childMax, maxLeaves[slot])
          && coveringContains(coverings[slot], child)) {
        fn(ids[slot])
      }
    }
  }
}

class BuildBoundaryIndex : PStage<PCollection<Boundary>, BoundaryIndex>() {

  override fun act(
      input: PCollection<Boundary>, dependants: Int): DisposableSupplier<BoundaryIndex> {
    val ids = ArrayList<Long>()
    val minLeaves = ArrayList<Long>()
    val maxLeaves = ArrayList<Long>()
    val coverings = ArrayList<LongArray>()
    val byEnclosingCell = HashMap<Long, MutableList<Int>>()
    val multiFace = ArrayList<Int>()

    var coversNothing = 0

    val executor = Executors.newFixedThreadPool(resolvedParallelism)
    try {
      longProgress("BuildBoundaryIndex covering boundaries") { progress ->
        while (input.hasNext()) {
          // Covering a polygon costs far more than reading one, so hand batches to the pool and
          // assemble in submission order. The window bounds how many coverings are in flight
          // beyond the ones already assembled.
          val batches = ArrayList<List<Boundary>>()
          while (input.hasNext() && batches.size < 2 * resolvedParallelism) {
            val batch = ArrayList<Boundary>(BATCH_SIZE)
            while (input.hasNext() && batch.size < BATCH_SIZE) {
              batch.add(input.next())
            }
            batches.add(batch)
          }

          val futures = batches.map { batch -> executor.submit(Callable { batch.map(::describe) }) }
          for (future in futures) {
            for (described in future.get()) {
              progress.increment()
              if (described == null) {
                coversNothing += 1
                continue
              }

              val slot = ids.size
              ids.add(described.id)
              minLeaves.add(described.minLeaf)
              maxLeaves.add(described.maxLeaf)
              coverings.add(described.covering)
              if (described.enclosingCell == NO_ENCLOSING_CELL) {
                multiFace.add(slot)
              } else {
                byEnclosingCell.computeIfAbsent(described.enclosingCell) { ArrayList() }.add(slot)
              }
            }
          }
        }
      }
    } finally {
      executor.shutdown()
    }
    input.close()

    val coveringCells = coverings.sumOf { it.size.toLong() }
    println(
        "  BoundaryIndex ${ids.size} boundaries, ${coveringCells} covering cells" +
            " (${8 * coveringCells} bytes), ${multiFace.size} spanning multiple faces," +
            " ${coversNothing} covering nothing")

    val index =
        BoundaryIndex(
            ids.toLongArray(),
            minLeaves.toLongArray(),
            maxLeaves.toLongArray(),
            coverings.toTypedArray(),
            byEnclosingCell.mapValues { (_, slots) -> slots.toIntArray() },
            multiFace.toIntArray())
    return DisposableSupplier({ }) { index }
  }
}

class FindBoundariesInBoundaries : PStage<BoundaryIndex, PMap<Long, Long>>() {

  override fun act(input: BoundaryIndex, dependants: Int): DisposableSupplier<PMap<Long, Long>> {
    return createPMap(
        "FindBoundariesInBoundaries",
        TypeToken.of(Long::class.java),
        TypeToken.of(Long::class.java),
        input.size * BYTES_PER_CHILD_BOUNDARY,
        slots(input),
        resolvedParallelism,
    ) { slot, emitter ->
      val child = input.id(slot)
      input.forEachContaining(input.covering(slot), child) { parent ->
        emitter.emit(child, parent)
      }
    }
  }
}

class FindTrailsInBoundaries
  : PStage<Pair<BoundaryIndex, PCollection<Trail>>, PMap<Long, Long>>() {

  override fun act(
      input: Pair<BoundaryIndex, PCollection<Trail>>,
      dependants: Int): DisposableSupplier<PMap<Long, Long>> {
    val (index, trails) = input
    return createPMap(
        "FindTrailsInBoundaries",
        TypeToken.of(Long::class.java),
        TypeToken.of(Long::class.java),
        estimateSize(trails.estimatedByteSize()),
        trails,
        resolvedParallelism,
    ) { trail, emitter ->
      index.forEachContaining(coveringOf(trail.polyline), NO_SKIP) { boundary ->
        emitter.emit(trail.relationId, boundary)
      }
    }
  }

  // Epoch 260715 wrote 1,972,095 trail pairs for 318,876 trails, so about 6 boundaries each, and a
  // merged record is an 8 byte key, a varint count, and 8 bytes a boundary.
  // => 8 + 1 + 6 * 8 = 57 bytes a trail
  // => 421,637 trails at 57 bytes is 24 MB against a 1.6 GB Trail list
  override fun estimateRatio(): Double {
    return 0.015
  }
}

// Big enough that dispatch overhead disappears against a batch of polygon coverings, small enough
// that a batch's results are a rounding error against the assembled index.
private const val BATCH_SIZE = 256

private class DescribedBoundary(
    val id: Long,
    val enclosingCell: Long,
    val minLeaf: Long,
    val maxLeaf: Long,
    val covering: LongArray)

private fun describe(boundary: Boundary): DescribedBoundary? {
  val covering = coveringOf(S2Polygon.decode(ByteArrayInputStream(boundary.s2Polygon)))
  // A relation whose loops never assembled covers nothing. Indexing it would report it as
  // contained by every boundary around it, because a union contains the empty union.
  if (covering.isEmpty()) {
    return null
  }

  return DescribedBoundary(
      boundary.id,
      smallestEnclosingCell(covering)?.id() ?: NO_ENCLOSING_CELL,
      cellRangeMin(covering[0]),
      cellRangeMax(covering[covering.size - 1]),
      covering)
}

// The parallel createPMap drives a PCollection, so hand it slot numbers rather than re-reading the
// boundaries and covering all of them a second time.
private fun slots(index: BoundaryIndex): PCollection<Int> {
  return object : PCollection<Int> {

    private var next = 0

    override fun estimatedByteSize(): Long {
      return 4L * index.size
    }

    override fun hasNext(): Boolean {
      return next < index.size
    }

    override fun next(): Int {
      return next++
    }

    override fun close() {}
  }
}

fun coveringOf(polygon: S2Polygon): LongArray {
  return toCellIds(COVERER.getCovering(polygon))
}

fun coveringOf(polyline: S2Polyline): LongArray {
  val cells = ArrayList<S2CellId>()
  var lastCell = S2CellId(0)
  // A good question to ask: is this safe? We might skip over cells if the points are very spread
  // apart. We luck out here because we are looking for full containment, ie the entirety of the
  // polyline must be contained for containment. Since there can be no points in the polyline
  // outside the bounds of this S2CellUnion, it works out.
  for (vertex in polyline.vertices()) {
    val cell = S2CellId.fromPoint(vertex).parent(SNAP_CELL_LEVEL)
    if (cell != lastCell) {
      cells.add(cell)
      lastCell = cell
    }
  }
  val covering = S2CellUnion()
  covering.initFromCellIds(cells)
  return toCellIds(covering)
}

// initFromCellIds and getCovering both normalize, so the cells arrive disjoint and ascending by
// unsigned id. coveringContains and smallestEnclosingCell both require that order, so never sort
// the result with signed comparison.
private fun toCellIds(union: S2CellUnion): LongArray {
  val cells = LongArray(union.size())
  for (i in cells.indices) {
    cells[i] = union.cellId(i).id()
  }
  return cells
}

/**
 * Whether every cell of [child] lies inside a single cell of [parent], which is what
 * S2CellUnion#contains(S2CellUnion) reports for normalized unions.
 *
 * Both arrays must be normalized, so their cells are disjoint and ascending. That lets one forward
 * walk of [parent] replace a binary search per child cell, and it means a child cell covered by
 * the union is covered by one of its cells: four siblings would have merged into their parent.
 */
fun coveringContains(parent: LongArray, child: LongArray): Boolean {
  var i = 0
  for (cell in child) {
    val childMin = cellRangeMin(cell)
    val childMax = cellRangeMax(cell)
    while (i < parent.size && unsignedLess(cellRangeMax(parent[i]), childMin)) {
      i += 1
    }

    if (i == parent.size) {
      return false
    }
    // Either a gap in the parent, or the child cell is the larger of the two and holds parent[i].
    if (!unsignedLessOrEqual(cellRangeMin(parent[i]), childMin)
        || !unsignedLessOrEqual(childMax, cellRangeMax(parent[i]))) {
      return false
    }
  }
  return true
}

/**
 * The smallest cell whose leaf range covers all of [covering], or null when the covering spans
 * more than one face and no such cell exists.
 */
fun smallestEnclosingCell(covering: LongArray): S2CellId? {
  val low = cellRangeMin(covering[0])
  val high = cellRangeMax(covering[covering.size - 1])
  // Walking up from the leaf holding the low end keeps the low end covered at every level, so only
  // the high end has to be tested.
  var cell = S2CellId(low)
  while (!unsignedLessOrEqual(high, cell.rangeMax().id())) {
    if (cell.level() == 0) {
      return null
    }
    cell = cell.parent()
  }
  return cell
}

// The lowest set bit of a cell id marks its level, and the cell spans the leaf ids within that
// bit's reach.
fun cellRangeMin(cell: Long): Long {
  return cell - ((cell and -cell) - 1)
}

fun cellRangeMax(cell: Long): Long {
  return cell + ((cell and -cell) - 1)
}

// Faces 4 and 5 set the high bit, so signed comparison sorts them below face 0.
private fun unsignedLess(a: Long, b: Long): Boolean {
  return java.lang.Long.compareUnsigned(a, b) < 0
}

private fun unsignedLessOrEqual(a: Long, b: Long): Boolean {
  return java.lang.Long.compareUnsigned(a, b) <= 0
}
