package org.trailcatalog.importers.basemap

import com.google.common.geometry.S2Cell
import com.google.common.geometry.S2CellId
import com.google.common.geometry.S2CellUnion
import com.google.common.geometry.S2LatLng
import com.google.common.geometry.S2Loop
import com.google.common.geometry.S2Point
import com.google.common.geometry.S2Polygon
import com.google.common.truth.Truth.assertThat
import org.junit.Test
import org.trailcatalog.importers.pipeline.collections.PCollection
import java.io.ByteArrayOutputStream
import java.util.Random

// The containment stages decide with S2CellUnion#contains, so the replacement is only correct if
// coveringContains agrees with it on the shapes the importer actually produces, and if the
// enclosing cell walk can never skip a parent that would pass.
class BoundaryIndexTest {

  @Test
  fun coveringContainsAgreesWithS2OnNestedUnions() {
    val random = Random(20260728)
    var contained = 0
    for (i in 0 until 4000) {
      val outerLevel = random.nextInt(12)
      val outer = randomCell(random, outerLevel)
      val parent = unionOf(outer, randomCell(random, outerLevel))
      // Descendants of a cell in the parent are contained; siblings and unrelated cells usually
      // are not, which is what keeps both branches exercised.
      val child =
          when (i % 3) {
            0 -> unionOf(descendant(random, outer, 4), descendant(random, outer, 6))
            1 -> unionOf(outer.parent(outerLevel / 2))
            else -> unionOf(randomCell(random, outerLevel + 3))
          }

      val expected = parent.contains(child)
      if (expected) {
        contained += 1
      }
      assertThat(coveringContains(cellIdsOf(parent), cellIdsOf(child))).isEqualTo(expected)
    }

    // A run where nothing was ever contained would pass vacuously.
    assertThat(contained).isGreaterThan(1000)
  }

  @Test
  fun coveringContainsAgreesWithS2OnPolylineCoverings() {
    val random = Random(11)
    for (i in 0 until 400) {
      val center = randomCell(random, 6)
      val polygon = polygonOf(center)
      val parent = unionOfIds(coveringOf(polygon))
      val polyline = randomPolylineNear(random, center)
      val child = unionOfIds(coveringOf(polyline))

      assertThat(coveringContains(cellIdsOf(parent), cellIdsOf(child)))
          .isEqualTo(parent.contains(child))
    }
  }

  @Test
  fun containmentImpliesTheParentEnclosingCellIsAnAncestor() {
    val random = Random(7)
    var checked = 0
    for (i in 0 until 4000) {
      val outerLevel = random.nextInt(14)
      val outer = randomCell(random, outerLevel)
      val parent = unionOf(outer, randomCell(random, outerLevel))
      val child =
          if (i % 2 == 0) {
            unionOf(descendant(random, outer, 5))
          } else {
            unionOf(randomCell(random, outerLevel + 2))
          }
      if (!parent.contains(child)) {
        continue
      }
      checked += 1

      // This is the whole reason the ancestor walk finds every candidate: the child's enclosing
      // cell is a descendant of the parent's, so walking up from it reaches the parent's bucket. A
      // parent spanning faces has no bucket to reach and lives in multiFace, which every child
      // checks anyway.
      val parentCell = smallestEnclosingCell(cellIdsOf(parent)) ?: continue
      // A child inside a single face parent cannot itself span faces.
      val childCell = smallestEnclosingCell(cellIdsOf(child))
      assertThat(childCell).isNotNull()
      assertThat(parentCell.rangeMin().lessOrEquals(childCell!!.rangeMin())).isTrue()
      assertThat(parentCell.rangeMax().greaterOrEquals(childCell.rangeMax())).isTrue()
    }

    assertThat(checked).isGreaterThan(500)
  }

  @Test
  fun smallestEnclosingCellIsTheSmallestOne() {
    val random = Random(3)
    for (i in 0 until 2000) {
      val cells = unionOf(randomCell(random, random.nextInt(20)), randomCell(random, 10))
      val ids = cellIdsOf(cells)
      val enclosing = smallestEnclosingCell(ids) ?: continue

      val low = cellRangeMin(ids[0])
      val high = cellRangeMax(ids[ids.size - 1])
      assertThat(enclosing.rangeMin().lessOrEquals(S2CellId(low))).isTrue()
      assertThat(enclosing.rangeMax().greaterOrEquals(S2CellId(high))).isTrue()

      // No descendant can cover the range, and the only candidate is the child holding the low end.
      if (enclosing.level() < S2CellId.MAX_LEVEL) {
        val narrower = childContaining(enclosing, low)
        assertThat(narrower.rangeMax().greaterOrEquals(S2CellId(high))).isFalse()
      }
    }
  }

  @Test
  fun smallestEnclosingCellIsNullAcrossFaces() {
    val spanning = unionOf(S2CellId.fromFace(0), S2CellId.fromFace(1))
    assertThat(smallestEnclosingCell(cellIdsOf(spanning))).isNull()
  }

  @Test
  fun indexReportsTheSameParentsAsComparingEveryPair() {
    val random = Random(4242)
    val boundaries = ArrayList<Boundary>()

    // A nested family, so most boundaries have several real parents.
    val root = randomCell(random, 2)
    boundaries.add(boundaryOf(1, polygonOf(root)))
    var id = 2L
    for (level in 4..14 step 2) {
      repeat(3) {
        boundaries.add(boundaryOf(id++, polygonOf(descendant(random, root, level - root.level()))))
      }
    }
    // Unrelated boundaries elsewhere on the sphere.
    repeat(20) {
      boundaries.add(boundaryOf(id++, polygonOf(randomCell(random, 6))))
    }
    // A boundary spanning the face 0 and face 1 seam has no enclosing cell, so it only ever gets
    // found through the multi-face bucket.
    val spanning = bandPolygon(-5.0, 5.0, 40.0, 50.0)
    assertThat(smallestEnclosingCell(coveringOf(spanning))).isNull()
    boundaries.add(boundaryOf(id++, spanning))

    val index = BuildBoundaryIndex().act(collectionOf(boundaries), 1).invoke()
    assertThat(index.size).isEqualTo(boundaries.size)

    val expected = HashSet<Pair<Long, Long>>()
    val coverings = boundaries.associate { it.id() to unionOfIds(coveringOf(decode(it))) }
    for (child in boundaries) {
      for (parent in boundaries) {
        if (child.id() != parent.id()
            && coverings[parent.id()]!!.contains(coverings[child.id()]!!)) {
          expected.add(Pair(child.id(), parent.id()))
        }
      }
    }

    val found = HashSet<Pair<Long, Long>>()
    for (slot in 0 until index.size) {
      val child = index.id(slot)
      index.forEachContaining(index.covering(slot), child) { parent ->
        // A duplicate here would mean a boundary sat in two buckets, which is the bug the level 7
        // fan out had.
        assertThat(found.add(Pair(child, parent))).isTrue()
      }
    }

    assertThat(found).isEqualTo(expected)
    assertThat(expected).isNotEmpty()
  }

  @Test
  fun indexSkipsBoundariesThatCoverNothing() {
    val empty = boundaryOf(1, S2Polygon())
    val index = BuildBoundaryIndex().act(collectionOf(listOf(empty)), 1).invoke()

    assertThat(index.size).isEqualTo(0)
  }
}

private fun randomCell(random: Random, level: Int): S2CellId {
  var cell = S2CellId.fromFace(random.nextInt(6))
  repeat(level) { cell = cell.child(random.nextInt(4)) }
  return cell
}

private fun descendant(random: Random, of: S2CellId, levels: Int): S2CellId {
  var cell = of
  repeat(minOf(levels, S2CellId.MAX_LEVEL - of.level())) { cell = cell.child(random.nextInt(4)) }
  return cell
}

private fun childContaining(cell: S2CellId, leaf: Long): S2CellId {
  for (i in 0 until 4) {
    val child = cell.child(i)
    if (child.rangeMin().lessOrEquals(S2CellId(leaf))
        && child.rangeMax().greaterOrEquals(S2CellId(leaf))) {
      return child
    }
  }
  throw AssertionError("${cell} has no child holding ${leaf}")
}

private fun unionOf(vararg cells: S2CellId): S2CellUnion {
  return S2CellUnion().also { it.initFromCellIds(ArrayList(cells.toList())) }
}

private fun unionOfIds(ids: LongArray): S2CellUnion {
  val cells = ArrayList<S2CellId>(ids.size)
  for (id in ids) {
    cells.add(S2CellId(id))
  }
  return S2CellUnion().also { it.initFromCellIds(cells) }
}

private fun cellIdsOf(union: S2CellUnion): LongArray {
  val cells = LongArray(union.size())
  for (i in cells.indices) {
    cells[i] = union.cellId(i).id()
  }
  return cells
}

private fun polygonOf(cell: S2CellId): S2Polygon {
  return S2Polygon(S2Loop(S2Cell(cell)))
}

private fun bandPolygon(
    latLow: Double, latHigh: Double, lngLow: Double, lngHigh: Double): S2Polygon {
  val corners =
      listOf(
          S2LatLng.fromDegrees(latLow, lngLow).toPoint(),
          S2LatLng.fromDegrees(latLow, lngHigh).toPoint(),
          S2LatLng.fromDegrees(latHigh, lngHigh).toPoint(),
          S2LatLng.fromDegrees(latHigh, lngLow).toPoint())
  return S2Polygon(S2Loop(corners))
}

private fun randomPolylineNear(random: Random, center: S2CellId): com.google.common.geometry.S2Polyline {
  val origin = S2LatLng(S2Cell(center).center)
  val points = ArrayList<S2Point>()
  repeat(6) {
    points.add(
        S2LatLng.fromDegrees(
                origin.latDegrees() + (random.nextDouble() - 0.5) * 2,
                origin.lngDegrees() + (random.nextDouble() - 0.5) * 2)
            .toPoint())
  }
  return com.google.common.geometry.S2Polyline(points)
}

private fun boundaryOf(id: Long, polygon: S2Polygon): Boundary {
  val encoded = ByteArrayOutputStream().also { polygon.encode(it) }
  return Boundary(id, 0, 0, "b${id}", encoded.toByteArray())
}

private fun decode(boundary: Boundary): S2Polygon {
  return S2Polygon.decode(java.io.ByteArrayInputStream(boundary.s2Polygon()))
}

private fun collectionOf(boundaries: List<Boundary>): PCollection<Boundary> {
  return object : PCollection<Boundary> {

    private var next = 0

    override fun estimatedByteSize(): Long {
      return 0
    }

    override fun hasNext(): Boolean {
      return next < boundaries.size
    }

    override fun next(): Boundary {
      return boundaries[next++]
    }

    override fun close() {}
  }
}
