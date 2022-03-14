package org.trailcatalog

import com.google.common.collect.ArrayListMultimap
import com.google.common.collect.Lists
import com.google.common.geometry.S2LatLng
import com.google.common.geometry.S2LatLngRect
import com.google.common.geometry.S2Point
import com.google.common.geometry.S2Polyline
import com.google.devtools.build.runfiles.Runfiles
import crosby.binary.Osmformat.PrimitiveBlock
import org.postgresql.copy.CopyManager
import org.postgresql.core.BaseConnection
import org.trailcatalog.pbf.BoundariesCsvInputStream
import org.trailcatalog.pbf.PathsCsvInputStream
import org.trailcatalog.pbf.PathsInTrailsCsvInputStream
import org.trailcatalog.pbf.PbfBlockReader
import org.trailcatalog.pbf.TrailsCsvInputStream
import java.io.FileInputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.sql.Connection
import java.sql.DriverManager
import kotlin.collections.ArrayList
import kotlin.collections.HashMap
import org.trailcatalog.s2.boundToCell

fun main(args: Array<String>) {
  val connection =
      DriverManager.getConnection(
          "jdbc:postgresql://10.110.231.203:5432/trailcatalog?currentSchema=public",
          "postgres",
          "postgres")
  seedFromPbf(connection)
}

fun seedFromPbf(connection: Connection) {
  if (!(connection is BaseConnection)) {
    throw RuntimeException("Connection is not a Postgres BaseConnection")
  }

  val reader = PbfBlockReader(
      FileInputStream(
          Runfiles.create().rlocation("trailcatalog/java/org/trailcatalog/washington-latest.osm.pbf")))
  val copier = CopyManager(connection)
  val nodes = HashMap<Long, Pair<Double, Double>>()
  val relations = HashMap<Long, ByteArray>()
  val relationWays = HashMap<Long, ByteArray>()
  val ways = HashMap<Long, ByteArray>()

  for (block in reader.readBlocks()) {
    gatherNodes(block, nodes)
    copier.copyIn(
        "COPY paths FROM STDIN WITH CSV HEADER", PathsCsvInputStream(nodes, ways, block))
    copier.copyIn(
        "COPY boundaries FROM STDIN WITH CSV HEADER",
        BoundariesCsvInputStream(nodes, relations, relationWays, ways, block))
    copier.copyIn(
        "COPY trails FROM STDIN WITH CSV HEADER", TrailsCsvInputStream(nodes, relations, block))
    copier.copyIn(
        "COPY paths_in_trails FROM STDIN WITH CSV HEADER",
        PathsInTrailsCsvInputStream(relationWays, block))
  }
}

/** Projects into Mercator space from -1 to 1. */
fun project(ll: S2LatLng): Pair<Double, Double> {
  val x = ll.lngRadians() / Math.PI
  val y = Math.log((1 + Math.sin(ll.latRadians())) / (1 - Math.sin(ll.latRadians()))) / (2 * Math.PI)
  return Pair(x, y)
}

fun correctMemberships(connection: Connection) {
  // Yikes!!!
  connection.createStatement().use {
    it.execute("""
      UPDATE highways
      SET routes = routes || subquery.rs
      FROM (
        SELECT ARRAY_AGG(r.id) as rs, h as h_id
        FROM routes r, UNNEST(r.highways) h
        GROUP BY h_id
      ) AS subquery
      WHERE id = subquery.h_id;
    """);
  }

  val routeBounds = HashMap<Long, S2LatLngRect.Builder>()
  connection.createStatement().use {
    val results = it.executeQuery("""
      SELECT r.id, h.latlng_doubles
      FROM routes r, UNNEST(r.highways) rh
      JOIN highways h ON rh = h.id
    """)
    while (results.next()) {
      val routeId = results.getLong(1)
      if (!routeBounds.containsKey(routeId)) {
        routeBounds[routeId] = S2LatLngRect.empty().toBuilder()
      }

      val bound = routeBounds[routeId]!!
      val bytes = results.getBytes(2)
      val doubles = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN).asDoubleBuffer()
      for (i in 0 until doubles.limit() step 2) {
        bound.addPoint(S2LatLng.fromRadians(doubles[i], doubles[i + 1]))
      }
    }
  }

  for ((routeId, bound) in routeBounds) {
    connection.prepareStatement( "UPDATE routes SET cell = ? WHERE id = ?").use {
      it.setLong(1, boundToCell(bound.build()).id())
      it.setLong(2, routeId)
      it.execute()
    }
  }
}

fun positionRoutes(connection: Connection) {
  val routeMembers = ArrayListMultimap.create<Long, List<S2Point>>()
  connection.createStatement().use {
    val results = it.executeQuery("""
      SELECT r.id, h.latlng_doubles
      FROM routes r, UNNEST(r.highways) rh
      JOIN highways h ON rh = h.id
    """)
    while (results.next()) {
      val routeId = results.getLong(1)
      val bytes = results.getBytes(2)
      val doubles = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN).asDoubleBuffer()
      val points = ArrayList<S2Point>()
      for (i in 0 until doubles.limit() step 2) {
        points.add(S2LatLng.fromRadians(doubles[i], doubles[i + 1]).toPoint())
      }
      routeMembers[routeId].add(points)
    }
  }

  for (routeId in routeMembers.keys()) {
    val merged = joinPolylines(routeMembers[routeId])
    val center = merged.interpolate(0.5)
    val projected = project(S2LatLng(center))
    connection.prepareStatement(
        "UPDATE routes SET x = ?, y = ? WHERE id = ?").use {
      it.setDouble(1, projected.first)
      it.setDouble(2, projected.second)
      it.setLong(3, routeId)
      it.execute()
    }
  }
}

/**
 * It's very hard for us to handle routes that are sorted incorrectly or are non-linear, so we
 * mostly don't. The exception is that we will try flipping polylines if they aren't contiguous.
 */
fun joinPolylines(polylines: List<List<S2Point>>): S2Polyline {
  val points = ArrayList<S2Point>()
  var lastPoint = S2Point.ORIGIN
  for (polyline in polylines) {
    if (polyline[0] != lastPoint && polyline[polyline.size - 1] == lastPoint) {
      Lists.reverse(polyline)
    }
    points.addAll(polyline)
    lastPoint = polyline[polyline.size - 1]
  }
  return S2Polyline(points)
}

fun gatherNodes(block: PrimitiveBlock, nodes: MutableMap<Long, Pair<Double, Double>>) {
  for (group in block.primitivegroupList) {
    for (node in group.nodesList) {
      val latDegrees = (block.latOffset + block.granularity * node.lat) * org.trailcatalog.pbf.NANO
      val lngDegrees = (block.lonOffset + block.granularity * node.lon) * org.trailcatalog.pbf.NANO
      nodes[node.id] = Pair(latDegrees, lngDegrees)
    }

    var denseId = 0L
    var denseLat = 0L
    var denseLon = 0L
    for (index in 0 until group.dense.idCount) {
      denseId += group.dense.idList[index]
      denseLat += group.dense.latList[index]
      denseLon += group.dense.lonList[index]

      val latDegrees = (block.latOffset + block.granularity * denseLat) * org.trailcatalog.pbf.NANO
      val lngDegrees = (block.lonOffset + block.granularity * denseLon) * org.trailcatalog.pbf.NANO
      nodes[denseId] = Pair(latDegrees, lngDegrees)
    }
  }
}