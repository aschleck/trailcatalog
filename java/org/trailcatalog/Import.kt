package org.trailcatalog

import com.google.common.base.Joiner
import com.google.common.collect.ArrayListMultimap
import com.google.common.collect.ImmutableMap
import com.google.common.geometry.S2CellId
import com.google.common.geometry.S2CellUnion
import com.google.common.geometry.S2LatLng
import com.google.common.geometry.S2LatLngRect
import com.google.common.geometry.S2RegionCoverer
import com.google.devtools.build.runfiles.Runfiles
import com.google.protobuf.ByteString
import com.wolt.osm.parallelpbf.blob.BlobInformation
import com.wolt.osm.parallelpbf.blob.BlobReader
import crosby.binary.Fileformat
import crosby.binary.Osmformat.PrimitiveBlock
import crosby.binary.Osmformat.Relation
import crosby.binary.Osmformat.Relation.MemberType.WAY
import crosby.binary.Osmformat.StringTable
import crosby.binary.Osmformat.Way
import java.io.FileInputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.charset.StandardCharsets
import java.sql.Connection
import java.sql.DriverManager
import java.util.Optional
import java.util.zip.Inflater
import kotlin.collections.ArrayList
import kotlin.collections.HashMap
import org.trailcatalog.s2.SimpleS2
import java.nio.DoubleBuffer

private const val NANO = .000000001

enum class HighwayCategory(val id: Int) {
  ANY(0),
    ROAD(1),
      // Normal roads
      ROAD_MOTORWAY(2),
      ROAD_TRUNK(3),
      ROAD_PRIMARY(4),
      ROAD_SECONDARY(5),
      ROAD_TERTIARY(6),
      ROAD_UNCLASSIFIED(7),
      ROAD_RESIDENTIAL(8),

      // Link roads
      ROAD_MOTORWAY_LINK(9),
      ROAD_TRUNK_LINK(10),
      ROAD_PRIMARY_LINK(11),
      ROAD_SECONDARY_LINK(12),
      ROAD_TERTIARY_LINK(13),

      // Special roads
      ROAD_LIVING_STREET(14),
      ROAD_SERVICE(15),
      ROAD_PEDESTRIAN(16),
      ROAD_TRACK(17),
      ROAD_BUS_GUIDEWAY(18),
      ROAD_ESCAPE(19),
      ROAD_RACEWAY(20),
      ROAD_BUSWAY(21),
    PATH(65),
      PATH_FOOTWAY(66),
      PATH_BRIDLEWAY(67),
      PATH_STEPS(68),
      PATH_CORRIDOR(69),
}

val HIGHWAY_CATEGORY_NAMES = ImmutableMap.builder<String, HighwayCategory>()
    .put("road", HighwayCategory.ROAD)
    .put("motorway", HighwayCategory.ROAD_MOTORWAY)
    .put("trunk", HighwayCategory.ROAD_TRUNK)
    .put("primary", HighwayCategory.ROAD_PRIMARY)
    .put("secondary", HighwayCategory.ROAD_SECONDARY)
    .put("tertiary", HighwayCategory.ROAD_TERTIARY)
    .put("unclassified", HighwayCategory.ROAD_UNCLASSIFIED)
    .put("residential", HighwayCategory.ROAD_RESIDENTIAL)

    .put("motorway_link", HighwayCategory.ROAD_MOTORWAY_LINK)
    .put("trunk_link", HighwayCategory.ROAD_TRUNK_LINK)
    .put("primary_link", HighwayCategory.ROAD_PRIMARY_LINK)
    .put("secondary_link", HighwayCategory.ROAD_SECONDARY_LINK)
    .put("tertiary_link", HighwayCategory.ROAD_TERTIARY_LINK)

    .put("living_street", HighwayCategory.ROAD_LIVING_STREET)
    .put("service", HighwayCategory.ROAD_SERVICE)
    .put("pedestrian", HighwayCategory.ROAD_PEDESTRIAN)
    .put("track", HighwayCategory.ROAD_TRACK)
    .put("bus_guideway", HighwayCategory.ROAD_BUS_GUIDEWAY)
    .put("escape", HighwayCategory.ROAD_ESCAPE)
    .put("raceway", HighwayCategory.ROAD_RACEWAY)
    .put("busway", HighwayCategory.ROAD_BUSWAY)

    .put("path", HighwayCategory.PATH)
    .put("footway", HighwayCategory.PATH_FOOTWAY)
    .put("bridleway", HighwayCategory.PATH_BRIDLEWAY)
    .put("steps", HighwayCategory.PATH_STEPS)
    .put("corridor", HighwayCategory.PATH_CORRIDOR)

    .build()

enum class RouteCategory(val id: Int) {
  ANY(0),
    TRANSPORT(1),
      TRANSPORT_BUS(2),
      TRANSPORT_DETOUR(3),
      TRANSPORT_FERRY(4),
      TRANSPORT_LIGHT_RAIL(5),
      TRANSPORT_RAILWAY(6),
      TRANSPORT_ROAD(7),
      TRANSPORT_SUBWAY(8),
      TRANSPORT_TRAIN(9),
      TRANSPORT_TRACKS(10),
      TRANSPORT_TRAM(11),
      TRANSPORT_TROLLEYBUS(12),
    TRAIL(65),
      TRAIL_BICYCLE(66),
      TRAIL_CANOE(67),
      TRAIL_FOOT(68),
      TRAIL_HIKING(69),
      TRAIL_HORSE(70),
      TRAIL_INLINE_SKATES(71),
      TRAIL_MTB(72),
      TRAIL_PISTE(73),
      TRAIL_RUNNING(74),
      TRAIL_SKIING(75),
}

val ROUTE_CATEGORY_NAMES = ImmutableMap.builder<String, RouteCategory>()
    .put("bus", RouteCategory.TRANSPORT_BUS)
    .put("detour", RouteCategory.TRANSPORT_DETOUR)
    .put("ferry", RouteCategory.TRANSPORT_FERRY)
    .put("light_rail", RouteCategory.TRANSPORT_LIGHT_RAIL)
    .put("railway", RouteCategory.TRANSPORT_RAILWAY)
    .put("road", RouteCategory.TRANSPORT_ROAD)
    .put("subway", RouteCategory.TRANSPORT_SUBWAY)
    .put("train", RouteCategory.TRANSPORT_TRAIN)
    .put("tracks", RouteCategory.TRANSPORT_TRACKS)
    .put("tram", RouteCategory.TRANSPORT_TRAM)
    .put("trolleybus", RouteCategory.TRANSPORT_TROLLEYBUS)

    .put("biycle", RouteCategory.TRAIL_BICYCLE)
    .put("canoe", RouteCategory.TRAIL_CANOE)
    .put("foot", RouteCategory.TRAIL_FOOT)
    .put("hiking", RouteCategory.TRAIL_HIKING)
    .put("horse", RouteCategory.TRAIL_HORSE)
    .put("inline_skates", RouteCategory.TRAIL_INLINE_SKATES)
    .put("mtb", RouteCategory.TRAIL_MTB)
    .put("piste", RouteCategory.TRAIL_PISTE)
    .put("running", RouteCategory.TRAIL_RUNNING)
    .put("skiing", RouteCategory.TRAIL_SKIING)

    .build()

val namelessRelations = ArrayList<Long>()

fun main(args: Array<String>) {
  val connection =
      DriverManager.getConnection(
          "jdbc:postgresql://10.110.231.203:5432/trailcatalog?currentSchema=migration_" +
              "1_create_geometry",
          "postgres",
          "postgres")
//  loadPbf(connection)
  correctMemberships(connection)
}

fun loadPbf(connection: Connection) {
  val reader =
    BlobReader(
        FileInputStream(
//            Runfiles.create().rlocation("trailcatalog/java/org/trailcatalog/highways.pbf")))
            Runfiles.create().rlocation("trailcatalog/java/org/trailcatalog/washington-latest.osm.pbf")))
  val allNodes = HashMap<Long, S2LatLng>()
  var maybeInformation: Optional<BlobInformation>
  do {
    maybeInformation = reader
        .readBlobHeaderLength()
        .flatMap { length ->
          reader.readBlobHeader(length)
        }
    maybeInformation
        .flatMap { information ->
          when (information.type) {
            BlobInformation.TYPE_OSM_DATA -> reader.readBlob(information.size)
            else -> {
              reader.skip(information.size)
              Optional.empty()
            }
          }
        }
        .map { data ->
          val blob = Fileformat.Blob.parseFrom(data)
          val payload = when {
            blob.hasZlibData() -> {
              val inflater = Inflater()
              inflater.setInput(blob.zlibData.toByteArray())
              val decompressed = ByteArray(blob.rawSize)
              val size = inflater.inflate(decompressed)
              if (size != decompressed.size) {
                throw IllegalStateException("Payload size mismatch: $size vs ${decompressed.size}")
              } else {
                decompressed
              }
            }
            blob.hasRaw() -> blob.raw.toByteArray()
            else -> throw AssertionError("Unknown type of blob")
          }
          PrimitiveBlock.parseFrom(payload)
        }
        .map { block ->
          for (group in block.primitivegroupList) {
            for (node in group.nodesList) {
              allNodes[node.id] =
                  S2LatLng.fromDegrees(
                      (block.latOffset + block.granularity * node.lat) * NANO,
                      (block.lonOffset + block.granularity * node.lon) * NANO)
            }

            var denseId = 0L
            var denseLat = 0L
            var denseLon = 0L
            for (index in 0 until group.dense.idCount) {
              denseId += group.dense.idList[index]
              denseLat += group.dense.latList[index]
              denseLon += group.dense.lonList[index]

              allNodes[denseId] =
                  S2LatLng.fromDegrees(
                      (block.latOffset + block.granularity * denseLat) * NANO,
                      (block.lonOffset + block.granularity * denseLon) * NANO)
            }

            for (relation in group.relationsList) {
              loadRelation(relation, block.stringtable, connection)
            }

            for (way in group.waysList) {
              loadWay(way, allNodes, block.stringtable, connection)
            }
          }
        }
  } while (maybeInformation.isPresent)

  println("Relations missing names: ${Joiner.on(", ").join(namelessRelations)}")
}

val HIGHWAY_BS = ByteString.copyFrom("highway", StandardCharsets.UTF_8)
val NAME_BS = ByteString.copyFrom("name", StandardCharsets.UTF_8)
val NETWORK_BS = ByteString.copyFrom("network", StandardCharsets.UTF_8)
val REF_BS = ByteString.copyFrom("ref", StandardCharsets.UTF_8)
val ROUTE_BS = ByteString.copyFrom("route", StandardCharsets.UTF_8)

fun loadRelation(
  relation: Relation,
  stringTable: StringTable,
  connection: Connection
) {
  var category: RouteCategory? = null
  var name: String? = null
  var network: String? = null
  var ref: String? = null
  for (i in 0 until relation.keysCount) {
    val key = relation.getKeys(i)
    when (stringTable.getS(key)) {
      NAME_BS ->
        name = stringTable.getS(relation.getVals(i)).toStringUtf8()
      NETWORK_BS ->
        network = stringTable.getS(relation.getVals(i)).toStringUtf8()
      REF_BS ->
        ref = stringTable.getS(relation.getVals(i)).toStringUtf8()
      ROUTE_BS ->
        category = ROUTE_CATEGORY_NAMES[stringTable.getS(relation.getVals(i)).toStringUtf8()]
    }
  }
  if (category == null) {
    println(relation.id)
    return
  }

  val resolvedName =
    if (name != null) {
      name
    } else if (network != null && ref != null) {
      "${network} ${ref}"
    } else {
      namelessRelations.add(relation.id)
      println(relation.id)
      return
    }

  val highways = ArrayList<Long>()
  var memId = 0L
  for (i in 0 until relation.memidsCount) {
    memId += relation.getMemids(i)

    if (relation.getTypes(i) == WAY) {
      highways.add(memId)
    }
  }

  connection.prepareStatement(
      "INSERT INTO routes (id, type, cell, name, highways) " +
          "VALUES (?, ?, ?, ?, ?) " +
          "ON CONFLICT (id) DO UPDATE SET " +
          "type = EXCLUDED.type, " +
          "cell = EXCLUDED.cell, " +
          "name = EXCLUDED.name, " +
          "highways = EXCLUDED.highways").apply {
    setLong(1, relation.id)
    setInt(2, category.id)
    setLong(3, 0)
    setString(4, resolvedName)
    setArray(5, connection.createArrayOf("BIGINT", highways.toArray()))
    execute()
  }
}

fun loadWay(
  way: Way,
  allNodes: HashMap<Long, S2LatLng>,
  stringTable: StringTable,
  connection: Connection
) {
  var category: HighwayCategory? = null
  var name: String? = null
  for (i in 0 until way.keysCount) {
    when (stringTable.getS(way.getKeys(i))) {
      HIGHWAY_BS ->
        category = HIGHWAY_CATEGORY_NAMES[stringTable.getS(way.getVals(i)).toStringUtf8()]
      NAME_BS ->
        name = stringTable.getS(way.getVals(i)).toStringUtf8()
    }
  }
  if (category == null) {
    return
  }

  val bound = S2LatLngRect.empty().toBuilder()
  val latLngBytes = ByteBuffer.allocate(way.refsCount * 2 * 8).order(ByteOrder.LITTLE_ENDIAN)
  val latLngDoubles = latLngBytes.asDoubleBuffer()
  val mercatorBytes = ByteBuffer.allocate(way.refsCount * 2 * 2 * 4).order(ByteOrder.LITTLE_ENDIAN)
  val mercatorDoubles = mercatorBytes.asDoubleBuffer()
  var nodeId = 0L
  for (delta in way.refsList) {
    nodeId += delta
    val point = allNodes[nodeId]!!
    bound.addPoint(point)

    latLngDoubles.put(point.latRadians())
    latLngDoubles.put(point.lngRadians())

    val projected = project(point)
    mercatorDoubles.put(projected.first)
    mercatorDoubles.put(projected.second)
  }
  var containedBy = boundToCell(bound.build())

  connection.prepareStatement(
      "INSERT INTO highways (id, type, cell, name, routes, latlng_doubles, mercator_doubles) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?) " +
          "ON CONFLICT (id) DO UPDATE SET " +
          "type = EXCLUDED.type, " +
          "cell = EXCLUDED.cell, " +
          "name = EXCLUDED.name, " +
          "routes = EXCLUDED.routes, " +
          "latlng_doubles = EXCLUDED.latlng_doubles, " +
          "mercator_doubles = EXCLUDED.mercator_doubles").use {
    it.setLong(1, way.id)
    it.setInt(2, category.id)
    it.setLong(3, containedBy.id())
    it.setString(4, name)
    it.setArray(5, connection.createArrayOf("BIGINT", arrayOf<Long>()))
    it.setBytes(6, latLngBytes.array())
    it.setBytes(7, mercatorBytes.array())
    it.execute()
  }
}

/** Projects into Mercator space from -1 to 1. */
fun project(ll: S2LatLng): Pair<Double, Double> {
  val x = ll.lngRadians() / Math.PI
  val y = Math.log((1 + Math.sin(ll.latRadians())) / (1 - Math.sin(ll.latRadians()))) / (2 * Math.PI)
  return Pair(x, y)
}

fun correctMemberships(connection: Connection) {
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

fun boundToCell(bound: S2LatLngRect): S2CellId {
  val covering =
    S2RegionCoverer.builder()
        .setMaxLevel(SimpleS2.HIGHEST_INDEX_LEVEL)
        .build()
        .getCovering(bound)
  var containedBy =
    S2CellId.fromLatLng(bound.center)
        .parent(SimpleS2.HIGHEST_INDEX_LEVEL)
  val neighbors = ArrayList<S2CellId>()
  val union = S2CellUnion()
  while (containedBy.level() > 0) {
    neighbors.clear()
    neighbors.add(containedBy)
    containedBy.getAllNeighbors(containedBy.level(), neighbors)
    union.initFromCellIds(neighbors)
    if (union.contains(covering)) {
      return containedBy
    } else {
      containedBy = containedBy.parent()
    }
  }
  throw IllegalStateException("${bound} contained by any cell")
}