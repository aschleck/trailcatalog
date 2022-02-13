package org.trailcatalog

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
import crosby.binary.Osmformat
import crosby.binary.Osmformat.Way
import java.io.FileInputStream
import java.nio.ByteBuffer
import java.nio.charset.StandardCharsets
import java.sql.Connection
import java.sql.DriverManager
import java.util.Optional
import java.util.zip.Inflater
import kotlin.collections.ArrayList
import kotlin.collections.HashMap

private const val NANO = .000000001

enum class WayCategory(val id: Int) {
  ROAD(0),
    // Roads
    ROAD_MOTORWAY(1),
    ROAD_TRUNK(2),
    ROAD_PRIMARY(3),
    ROAD_SECONDARY(4),
    ROAD_TERTIARY(5),
    ROAD_UNCLASSIFIED(6),
    ROAD_RESIDENTIAL(7),

    // Link roads
    ROAD_MOTORWAY_LINK(8),
    ROAD_TRUNK_LINK(9),
    ROAD_PRIMARY_LINK(10),
    ROAD_SECONDARY_LINK(11),
    ROAD_TERTIARY_LINK(12),

    // Special roads
    ROAD_LIVING_STREET(13),
    ROAD_SERVICE(14),
    ROAD_PEDESTRIAN(15),
    ROAD_TRACK(16),
    ROAD_BUS_GUIDEWAY(17),
    ROAD_ESCAPE(18),
    ROAD_RACEWAY(19),
    ROAD_BUSWAY(20),
  PATH(1024),
    PATH_FOOTWAY(1025),
    PATH_BRIDLEWAY(1026),
    PATH_STEPS(1027),
    PATH_CORRIDOR(1028),
}

val WAY_CATEGORY_NAMES = ImmutableMap.builder<String, WayCategory>()
    .put("road", WayCategory.ROAD)
    .put("motorway", WayCategory.ROAD_MOTORWAY)
    .put("trunk", WayCategory.ROAD_TRUNK)
    .put("primary", WayCategory.ROAD_PRIMARY)
    .put("secondary", WayCategory.ROAD_SECONDARY)
    .put("tertiary", WayCategory.ROAD_TERTIARY)
    .put("unclassified", WayCategory.ROAD_UNCLASSIFIED)
    .put("residential", WayCategory.ROAD_RESIDENTIAL)

    .put("motorway_link", WayCategory.ROAD_MOTORWAY_LINK)
    .put("trunk_link", WayCategory.ROAD_TRUNK_LINK)
    .put("primary_link", WayCategory.ROAD_PRIMARY_LINK)
    .put("secondary_link", WayCategory.ROAD_SECONDARY_LINK)
    .put("tertiary_link", WayCategory.ROAD_TERTIARY_LINK)

    .put("living_street", WayCategory.ROAD_LIVING_STREET)
    .put("service", WayCategory.ROAD_SERVICE)
    .put("pedestrian", WayCategory.ROAD_PEDESTRIAN)
    .put("track", WayCategory.ROAD_TRACK)
    .put("bus_guideway", WayCategory.ROAD_BUS_GUIDEWAY)
    .put("escape", WayCategory.ROAD_ESCAPE)
    .put("raceway", WayCategory.ROAD_RACEWAY)
    .put("busway", WayCategory.ROAD_BUSWAY)

    .put("path", WayCategory.PATH)
    .put("footway", WayCategory.PATH_FOOTWAY)
    .put("bridleway", WayCategory.PATH_BRIDLEWAY)
    .put("steps", WayCategory.PATH_STEPS)
    .put("corridor", WayCategory.PATH_CORRIDOR)

    .build()

fun main(args: Array<String>) {
  val connection =
      DriverManager.getConnection(
          "jdbc:postgresql://10.110.231.203:5432/trailcatalog?currentSchema=migration_" +
              "1_create_geometry",
          "postgres",
          "postgres")

  val allNodes = HashMap<Long, S2LatLng>()
  val reader =
    BlobReader(
        FileInputStream(
            Runfiles.create().rlocation("trailcatalog/java/org/trailcatalog/highways.pbf")))
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
          Osmformat.PrimitiveBlock.parseFrom(payload)
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

            for (way in group.waysList) {
              loadWay(way, allNodes, block.stringtable, connection)
            }
          }
        }
  } while (maybeInformation.isPresent)
}

val HIGHWAY_BS = ByteString.copyFrom("highway", StandardCharsets.UTF_8)

fun loadWay(
  way: Way,
  allNodes: HashMap<Long, S2LatLng>,
  stringTable: Osmformat.StringTable,
  connection: Connection
) {
  var category: WayCategory? = null
  for (i in 0 until way.keysCount) {
    if (stringTable.getS(way.getKeys(i)) == HIGHWAY_BS) {
      category = WAY_CATEGORY_NAMES[stringTable.getS(way.getVals(i)).toStringUtf8()]
      break
    }
  }
  if (category == null) {
    return
  }

  val bound = S2LatLngRect.empty().toBuilder()
  val bytes = ByteBuffer.allocate(way.refsCount * 2 * 2 * 4)
  val floats = bytes.asFloatBuffer()
  var nodeId = 0L
  for (delta in way.refsList) {
    nodeId += delta
    val point = allNodes[nodeId]!!
    bound.addPoint(point)

    val latF = point.latRadians().toFloat()
    floats.put(latF)
    floats.put((point.latRadians() - latF).toFloat())

    val lngF = point.lngRadians().toFloat()
    floats.put(lngF)
    floats.put((point.lngRadians() - lngF).toFloat())
  }
  val covering = S2RegionCoverer.builder().setMaxLevel(14).build().getCovering(bound)
  var containedBy = S2CellId.fromLatLng(bound.center).parent(14)
  val neighbors = ArrayList<S2CellId>()
  val union = S2CellUnion()
  while (containedBy.level() > 0) {
    neighbors.clear()
    neighbors.add(containedBy)
    containedBy.getAllNeighbors(containedBy.level(), neighbors)
    union.initFromCellIds(neighbors)
    if (union.contains(covering)) {
      break
    } else {
      containedBy = containedBy.parent()
    }
  }

  connection.prepareStatement(
      "INSERT INTO ways (id, type,cell, points_bytes) VALUES (?, ?, ?, ?)").apply {
    setLong(1, way.id)
    setInt(2, category.id)
    setLong(3, containedBy.id())
    setBytes(4, bytes.array())
    execute()
  }

  println("w${way.id} has ${way.refsCount} points in ${containedBy.toToken()}")
}
