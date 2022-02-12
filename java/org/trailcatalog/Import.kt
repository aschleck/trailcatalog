package org.trailcatalog

import com.google.common.geometry.S2CellId
import com.google.common.geometry.S2CellUnion
import com.google.common.geometry.S2LatLng
import com.google.common.geometry.S2LatLngRect
import com.google.common.geometry.S2Point
import com.google.common.geometry.S2RegionCoverer
import com.wolt.osm.parallelpbf.blob.BlobInformation
import com.wolt.osm.parallelpbf.blob.BlobReader
import crosby.binary.Fileformat
import crosby.binary.Osmformat
import crosby.binary.Osmformat.Way
import java.io.FileInputStream
import java.nio.ByteBuffer
import java.sql.Connection
import java.sql.DriverManager
import java.util.Optional
import java.util.zip.Inflater
import kotlin.collections.ArrayList
import kotlin.collections.HashMap

private const val NANO = .000000001

fun main(args: Array<String>) {
  val connection =
      DriverManager.getConnection(
          "jdbc:postgresql://mango:5432/trailcatalog?currentSchema=migration_" +
              "2_create_geometry",
          "postgres",
          "postgres")

  val allNodes = HashMap<Long, S2LatLng>()
  val reader = BlobReader(FileInputStream("highways.pbf"))
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
              loadWay(way, allNodes, connection)
            }
          }
        }
  } while (maybeInformation.isPresent)
}

fun loadWay(way: Way, allNodes: HashMap<Long, S2LatLng>, connection: Connection) {
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
      "INSERT INTO ways (id, cell, points_bytes) VALUES (?, ?, ?)").apply {
    setLong(1, way.id)
    setLong(2, containedBy.id())
    setBytes(3, bytes.array())
    execute()
  }

  println("w${way.id} has ${way.refsCount} points in ${containedBy.toToken()}")
}
