package org.trailcatalog.importers

import com.google.common.geometry.S2CellId
import com.google.common.geometry.S2LatLng
import com.google.common.geometry.S2Loop
import com.google.common.geometry.S2Point
import com.google.common.geometry.S2Polygon
import com.google.common.geometry.S2PolygonBuilder
import org.trailcatalog.createConnectionSource
import java.nio.ByteBuffer
import java.nio.ByteOrder

data class Boundary(val id: Long, val polygon: S2Polygon)

fun main(args: Array<String>) {
  createConnectionSource().connection.use {
    val fetchBoundaries = it.prepareStatement(
        "SELECT id, lat_lng_degrees "
            + "FROM boundaries "
            + "WHERE "
            + "((cell >= ? AND cell <= ?) OR (cell >= ? AND cell <= ?))")

    val level = 7
    val end = S2CellId.end(level)
    ProgressBar("seeding containments", "cells", end.pos()).use { progress ->
      var cell = S2CellId.begin(level)
      val found = ArrayList<Boundary>()
      val neighbors = ArrayList<S2CellId>()
      while (cell != end) {
        found.clear()
        neighbors.clear()

        var cursor = cell
        while (cursor.level() > 0) {
          neighbors.add(cursor)
          cursor = cursor.parent()
        }
        cell.getAllNeighbors(cell.level(), neighbors)

        for (c in neighbors) {
          val results = fetchBoundaries.apply {
            val min = c.rangeMin()
            val max = c.rangeMax()
            setLong(1, min.id())
            setLong(2, max.id())
            setLong(3, min.id() + Long.MIN_VALUE)
            setLong(4, max.id() + Long.MIN_VALUE)
          }.executeQuery()
          results.use {
            while (results.next()) {
              val id = results.getLong(1)
              val points = ArrayList<S2Point>()
              val latLngs =
                ByteBuffer.wrap(results.getBytes(2)).order(ByteOrder.LITTLE_ENDIAN).asDoubleBuffer()
              while (latLngs.hasRemaining()) {
                points.add(S2LatLng.fromDegrees(latLngs.get(), latLngs.get()).toPoint())
              }

              val polygon = S2PolygonBuilder()
              polygon.addLoop(S2Loop(points))
              found.add(Boundary(id, polygon.assemblePolygon()))
            }
          }
        }

        for (i in 0 until found.size) {
          for (j in (i + 1) until found.size) {
            val a = found[i]
            val b = found[j]

            if (a.polygon.contains(b.polygon)) {
              println("${a.id} contains ${b.id}")
            } else if (b.polygon.contains(a.polygon)) {
              println("${b.id} contains ${a.id}")
            }
          }
        }

        cell = cell.next()
        progress.increment()
      }
    }
  }
}
