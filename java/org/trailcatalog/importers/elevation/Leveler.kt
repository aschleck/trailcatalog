package org.trailcatalog.importers.elevation

import com.google.common.geometry.S2LatLng
import com.google.common.geometry.S2Point
import com.zaxxer.hikari.HikariDataSource
import org.trailcatalog.createConnectionSource
import org.trailcatalog.s2.earthMetersToAngle
import java.nio.ByteBuffer
import java.nio.ByteOrder.LITTLE_ENDIAN

fun main(args: Array<String>) {
  createConnectionSource(syncCommit = false).use { hikari ->
    val trails = arrayListOf(4137055L, 1855761L, 12409804L)
    calculateTrailProfiles(trails, hikari)
  }
}

private data class Profile(val up: Double, val down: Double)

private fun calculateTrailProfiles(trails: ArrayList<Long>, hikari: HikariDataSource) {
  val trailArray = trails.toArray()
  val paths = HashMap<Long, ByteArray>()
  val pathGeometries = HashMap<Long, ByteArray>()
  hikari.connection.use { connection ->
    connection
        .prepareStatement(
            "SELECT id, path_ids FROM trails WHERE id = ANY (?)").also {
          it.setArray(1, connection.createArrayOf("bigint", trailArray))
        }
        .executeQuery()
        .use {
          while (it.next()) {
            paths[it.getLong(1)] = it.getBytes(2)
          }
        }
    connection
        .prepareStatement(
            "SELECT p.id, p.lat_lng_degrees " +
                "FROM paths p " +
                "RIGHT JOIN paths_in_trails pit ON p.id = pit.path_id " +
                "WHERE pit.trail_id = ANY (?)")
        .also {
          it.setArray(1, connection.createArrayOf("bigint", trailArray))
        }
        .executeQuery()
        .use {
          while (it.next()) {
            pathGeometries[it.getLong(1)] = it.getBytes(2)
          }
        }
  }

  val resolver = DemResolver(hikari)
  val pathProfiles = calculatePathProfiles(pathGeometries, resolver)
  for ((trailId, pathIds) in paths) {
    val pathIdsBuffer = ByteBuffer.wrap(pathIds).order(LITTLE_ENDIAN).asLongBuffer()
    var totalUp = 0.0
    var totalDown = 0.0
    while (pathIdsBuffer.hasRemaining()) {
      val pathId = pathIdsBuffer.get()
      val profile = pathProfiles[pathId.and(1L.inv())]!!
      if (pathId % 2 == 0L) {
        totalUp += profile.up
        totalDown += profile.down
      } else {
        totalUp += profile.down
        totalDown += profile.up
      }

      println(trailId)
      println(Profile(totalUp, totalDown))
    }
  }
}

private fun calculatePathProfiles(geometry: Map<Long, ByteArray>, resolver: DemResolver):
    Map<Long, Profile> {
  val profiles = HashMap<Long, Profile>()
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
      last = resolver.query(S2LatLng(previous)).toDouble()
      while (position < length) {
        val fraction = Math.sin(position) / Math.sin(length)
        val ll =
            S2LatLng(
                S2Point.add(
                    S2Point.mul(previous, Math.cos(position) - fraction * Math.cos(length)),
                    S2Point.mul(next, fraction)))
        val height = resolver.query(ll).toDouble()
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

    profiles[id] = Profile(totalUp, totalDown)
  }
  return profiles
}