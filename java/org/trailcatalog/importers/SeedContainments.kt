package org.trailcatalog.importers

import com.google.common.collect.HashMultimap
import com.google.common.geometry.S2CellId
import com.google.common.geometry.S2LatLng
import com.google.common.geometry.S2Loop
import com.google.common.geometry.S2Point
import com.google.common.geometry.S2Polygon
import com.google.common.geometry.S2PolygonBuilder
import com.google.common.math.IntMath.pow
import java.io.ByteArrayInputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder.LITTLE_ENDIAN
import java.sql.Connection

data class Boundary(val id: Long, val polygon: S2Polygon)

fun fillBoundaryContainments(connection: Connection) {
  connection.autoCommit = false
  val fetchBoundaries = connection.prepareStatement(
      "SELECT id, s2_polygon "
          + "FROM boundaries "
          + "WHERE "
          + "(((cell >= ? AND cell <= ?) OR (cell >= ? AND cell <= ?)) OR cell = ANY (?))"
          + "AND length(s2_polygon) > 0")
  val deleteContainment = connection.prepareStatement(
      "DELETE FROM boundaries_in_boundaries WHERE child_id = ?")
  val addContainment = connection.prepareStatement(
      "INSERT INTO boundaries_in_boundaries (parent_id, child_id)" +
          "VALUES (?, ?) " +
          "ON CONFLICT DO NOTHING")

  val level = 7
  val end = S2CellId.end(level)
  ProgressBar("seeding boundary containments", "cells", 6 * pow(4, level)).use { progress ->
    var cell = S2CellId.begin(level)
    val found = ArrayList<Boundary>()
    val extras = ArrayList<S2CellId>()
    val containedBy = HashMultimap.create<Long, Long>()
    while (cell != end) {
      found.clear()
      extras.clear()
      containedBy.clear()

      var cursor = cell.parent()
      while (cursor.level() > 0) {
        extras.add(cursor)
        cursor = cursor.parent()
      }
      cell.getAllNeighbors(cell.level(), extras)

      fetchBoundaries.apply {
        val min = cell.rangeMin()
        val max = cell.rangeMax()
        setLong(1, min.id())
        setLong(2, max.id())
        setLong(3, min.id() + Long.MIN_VALUE)
        setLong(4, max.id() + Long.MIN_VALUE)
        setArray(5, connection.createArrayOf("bigint", extras.map { it.id() }.toTypedArray()))
      }.executeQuery().use {
        while (it.next()) {
          val id = it.getLong(1)
          val polygon = S2Polygon.decode(ByteArrayInputStream(it.getBytes(2)))
          found.add(Boundary(id, polygon))
        }
      }

      for (i in 0 until found.size) {
        for (j in (i + 1) until found.size) {
          val a = found[i]
          val b = found[j]

          if (a.polygon.contains(b.polygon)) {
            containedBy.put(b.id, a.id)
          } else if (b.polygon.contains(a.polygon)) {
            containedBy.put(a.id, b.id)
          }
        }
      }

      for (child in containedBy.keys()) {
        deleteContainment.apply {
          setLong(1, child)
          addBatch()
        }

        for (parent in containedBy[child]) {
          addContainment.apply {
            setLong(1, parent)
            setLong(2, child)
            addBatch()
          }
        }
      }
      deleteContainment.executeBatch()
      addContainment.executeBatch()
      connection.commit()

      cell = cell.next()
      progress.increment()
    }
  }

  connection.autoCommit = true
}

fun fillTrailContainments(connection: Connection) {
  connection.autoCommit = false
  val fetchBoundaries = connection.prepareStatement(
      "SELECT id, s2_polygon "
          + "FROM boundaries "
          + "WHERE "
          + "(((cell >= ? AND cell <= ?) OR (cell >= ? AND cell <= ?)) OR cell = ANY (?)) "
          + "AND length(s2_polygon) > 0")
  val fetchPaths = connection.prepareStatement(
      "SELECT id, lat_lng_degrees "
          + "FROM paths "
          + "WHERE "
          + "(((cell >= ? AND cell <= ?) OR (cell >= ? AND cell <= ?)) OR cell = ANY (?)) "
          + "AND length(lat_lng_degrees) > 0")
  val fetchTrails = connection.prepareStatement(
      "SELECT id, path_ids "
          + "FROM trails "
          + "WHERE "
          + "(((cell >= ? AND cell <= ?) OR (cell >= ? AND cell <= ?)) OR cell = ANY (?)) "
          + "AND length(path_ids) > 0")
  val deleteContainment = connection.prepareStatement(
      "DELETE FROM trails_in_boundaries WHERE trail_id = ?")
  val addContainment = connection.prepareStatement(
      "INSERT INTO trails_in_boundaries (boundary_id, trail_id) " +
          "VALUES (?, ?) " +
          "ON CONFLICT DO NOTHING")

  val level = 7
  val end = S2CellId.end(level)
  ProgressBar("seeding trail containments", "cells", 6 * pow(4, level)).use { progress ->
    var cell = S2CellId.begin(level)
    val boundaries = ArrayList<Boundary>()
    val extras = ArrayList<S2CellId>()
    val pathContainedBy = HashMultimap.create<Long, Boundary>()
    val trailContainedBy = HashMultimap.create<Long, Boundary>()
    while (cell != end) {
      boundaries.clear()
      extras.clear()
      pathContainedBy.clear()
      trailContainedBy.clear()

      var cursor = cell.parent()
      while (cursor.level() > 0) {
        extras.add(cursor)
        cursor = cursor.parent()
      }
      cell.getAllNeighbors(cell.level(), extras)

      fetchBoundaries.apply {
        val min = cell.rangeMin()
        val max = cell.rangeMax()
        setLong(1, min.id())
        setLong(2, max.id())
        setLong(3, min.id() + Long.MIN_VALUE)
        setLong(4, max.id() + Long.MIN_VALUE)
        setArray(5, connection.createArrayOf("bigint", extras.map { it.id() }.toTypedArray()))
      }.executeQuery().use {
        while (it.next()) {
          val id = it.getLong(1)
          val polygon = S2Polygon.decode(ByteArrayInputStream(it.getBytes(2)))
          boundaries.add(Boundary(id, polygon))
        }
      }

      fetchPaths.apply {
        val min = cell.rangeMin()
        val max = cell.rangeMax()
        setLong(1, min.id())
        setLong(2, max.id())
        setLong(3, min.id() + Long.MIN_VALUE)
        setLong(4, max.id() + Long.MIN_VALUE)
        setArray(5, connection.createArrayOf("bigint", extras.map { it.id() }.toTypedArray()))
      }.executeQuery().use {
        while (it.next()) {
          val id = it.getLong(1)
          val latLngs = ByteBuffer.wrap(it.getBytes(2)).order(LITTLE_ENDIAN).asDoubleBuffer()
          for (boundary in boundaries) {
            var contained = true
            for (i in 0 until latLngs.capacity() step 2) {
              if (!boundary.polygon.contains(S2LatLng.fromDegrees(latLngs[i], latLngs[i + 1]).toPoint())) {
                contained = false
                break
              }
            }
            if (contained) {
              pathContainedBy.put(id, boundary)
            }
          }
        }
      }

      fetchTrails.apply {
        val min = cell.rangeMin()
        val max = cell.rangeMax()
        setLong(1, min.id())
        setLong(2, max.id())
        setLong(3, min.id() + Long.MIN_VALUE)
        setLong(4, max.id() + Long.MIN_VALUE)
        setArray(5, connection.createArrayOf("bigint", extras.map { it.id() }.toTypedArray()))
      }.executeQuery().use {
        while (it.next()) {
          val id = it.getLong(1)
          val pathIds = ByteBuffer.wrap(it.getBytes(2)).order(LITTLE_ENDIAN).asLongBuffer()
          val possible = HashSet(pathContainedBy[pathIds[0] and 1L.inv()])
          for (i in 1 until pathIds.capacity()) {
            val inside = pathContainedBy[pathIds[i]]
            val iterator = possible.iterator()
            while (iterator.hasNext()) {
              if (!inside.contains(iterator.next())) {
                iterator.remove()
              }
            }
          }
          for (boundary in possible) {
            trailContainedBy.put(id, boundary)
          }
        }
      }

      for (trail in trailContainedBy.keys()) {
        deleteContainment.apply {
          setLong(1, trail)
          addBatch()
        }

        for (boundary in trailContainedBy[trail]) {
          addContainment.apply {
            setLong(1, boundary.id)
            setLong(2, trail)
            addBatch()
          }
        }
      }
      deleteContainment.executeBatch()
      addContainment.executeBatch()
      connection.commit()

      cell = cell.next()
      progress.increment()
    }
  }

  connection.autoCommit = true
}
