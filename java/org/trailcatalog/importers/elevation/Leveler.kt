package org.trailcatalog.importers.elevation

import com.google.common.geometry.S2LatLng
import com.google.common.geometry.S2Point
import org.trailcatalog.createConnectionSource
import org.trailcatalog.s2.earthMetersToAngle
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder.LITTLE_ENDIAN

fun main(args: Array<String>) {
  val geometry = HashMap<Long, ByteArray>()
  createConnectionSource(syncCommit = false).use { hikari ->
    hikari.connection.use { connection ->
      val trails = arrayListOf(4137055L)

      connection
          .prepareStatement(
              "SELECT p.id, p.lat_lng_degrees " +
                  "FROM paths p " +
                  "RIGHT JOIN paths_in_trails pit ON p.id = pit.path_id " +
                  "WHERE pit.trail_id = ANY (?)")
          .also {
            it.setArray(1, connection.createArrayOf("bigint", trails.toArray()))
          }
          .executeQuery()
          .use {
            while (it.next()) {
              geometry[it.getLong(1)] = it.getBytes(2)
            }
          }

      println(geometry)
    }
  }

  val dem = ProjectedDem(File(args[0]))
  for ((id, bytes) in geometry) {
    val e7s = ByteBuffer.wrap(bytes).order(LITTLE_ENDIAN).asIntBuffer()
    val points = ArrayList<S2Point>()
    while (e7s.hasRemaining()) {
      points.add(S2LatLng.fromE7(e7s.get(), e7s.get()).toPoint())
    }

    val increment = earthMetersToAngle(1.0)
    var offsetRadians = 0.0
    var current = 0
    var last: Double
    var totalUp = 0.0
    var totalDown = 0.0
    while (current < points.size - 1) {
      val previous = points[current]
      val next = points[current + 1]
      val length = previous.angle(next)
      var position = offsetRadians
      last = dem.query(S2LatLng(previous))
      while (position < length) {
        val fraction = Math.sin(position) / Math.sin(length)
        val ll =
            S2LatLng(
                S2Point.add(
                    S2Point.mul(previous, Math.cos(position) - fraction * Math.cos(length)),
                    S2Point.mul(next, fraction)))
        val height = dem.query(ll)
        val dz = height - last
        if (dz >= 0) {
          totalUp += dz
        } else {
          totalDown -= dz
        }
        last = height
        position += increment.radians()
      }
      current += 1
      offsetRadians = position - length
    }
    println(totalUp)
    println(totalDown)
  }
}