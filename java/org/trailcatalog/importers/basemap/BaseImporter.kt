package org.trailcatalog.importers.basemap

import com.google.common.geometry.S2Point
import com.google.common.geometry.S2Polyline
import com.google.common.reflect.TypeToken
import okhttp3.HttpUrl.Companion.toHttpUrl
import org.trailcatalog.createConnectionSource
import org.trailcatalog.importers.common.download
import org.trailcatalog.importers.pbf.LatLngE7
import org.trailcatalog.importers.pbf.registerPbfSerializers
import org.trailcatalog.importers.pipeline.collections.HEAP_DUMP_THRESHOLD
import org.trailcatalog.importers.pipeline.collections.Serializer
import org.trailcatalog.importers.pipeline.collections.registerSerializer
import org.trailcatalog.importers.pipeline.io.EncodedInputStream
import org.trailcatalog.importers.pipeline.io.EncodedOutputStream
import org.trailcatalog.importers.pipeline.io.BUFFER_SIZE
import org.trailcatalog.importers.pipeline.io.FLUSH_THRESHOLD
import java.io.File
import java.nio.file.Path
import java.time.LocalDateTime
import java.time.ZoneOffset
import kotlin.io.path.exists

fun processArgsAndGetPbfs(args: Array<String>): Pair<Int, List<Path>> {
  registerPbfSerializers()

  registerSerializer(TypeToken.of(Boundary::class.java), object : Serializer<Boundary> {
    override fun read(from: EncodedInputStream): Boundary {
      val id = from.readLong()
      val type = from.readInt()
      val cell = from.readLong()
      val name = ByteArray(from.readVarInt()).also {
        from.read(it)
      }.decodeToString()
      val polygon = ByteArray(from.readVarInt()).also {
        from.read(it)
      }
      return Boundary(id, type, cell, name, polygon)
    }

    override fun write(v: Boundary, to: EncodedOutputStream) {
      to.writeLong(v.id)
      to.writeInt(v.type)
      to.writeLong(v.cell)
      val name = v.name.encodeToByteArray()
      to.writeVarInt(name.size)
      to.write(name)
      to.writeVarInt(v.s2Polygon.size)
      to.write(v.s2Polygon)
    }
  })

  registerSerializer(TypeToken.of(BoundaryPolygon::class.java), object : Serializer<BoundaryPolygon> {
    override fun read(from: EncodedInputStream): BoundaryPolygon {
      val id = from.readLong()
      val polygon = ByteArray(from.readVarInt())
      from.read(polygon)
      return BoundaryPolygon(id, polygon)
    }

    override fun write(v: BoundaryPolygon, to: EncodedOutputStream) {
      to.writeLong(v.id)
      to.writeVarInt(v.polygon.size)
      to.write(v.polygon)
    }
  })

  registerSerializer(TypeToken.of(Profile::class.java), object : Serializer<Profile> {

    override fun read(from: EncodedInputStream): Profile {
      val id = from.readVarLong()
      val version = from.readVarInt()
      val down = from.readDouble()
      val up = from.readDouble()
      val profile = ArrayList<Float>()
      for (i in 0 until from.readVarInt()) {
        profile.add(from.readFloat())
      }
      return Profile(id, version, down, up, profile)
    }

    override fun write(v: Profile, to: EncodedOutputStream) {
      to.writeVarLong(v.id)
      to.writeVarInt(v.version)
      to.writeDouble(v.down)
      to.writeDouble(v.up)
      to.writeVarInt(v.profile.size)
      v.profile.forEach { to.writeFloat(it) }
    }
  })

  registerSerializer(TypeToken.of(Trail::class.java), object : Serializer<Trail> {
    override fun read(from: EncodedInputStream): Trail {
      val id = from.readLong()
      val type = from.readInt()
      val name = ByteArray(from.readVarInt()).also {
        from.read(it)
      }.decodeToString()
      val paths = LongArray(from.readVarInt()).also { array ->
        for (i in 0 until array.size) {
          array[i] = from.readLong()
        }
      }
      val pointCount = from.readVarInt()
      val points = ArrayList<S2Point>(pointCount)
      repeat(pointCount) {
        points.add(LatLngE7(from.readInt(), from.readInt()).toS2LatLng().toPoint())
      }
      val polyline = S2Polyline(points)
      return Trail(id, type, name, paths, polyline)
    }

    override fun write(v: Trail, to: EncodedOutputStream) {
      to.writeLong(v.relationId)
      to.writeInt(v.type)
      val name = v.name.encodeToByteArray()
      to.writeVarInt(name.size)
      to.write(name)
      to.writeVarInt(v.paths.size)
      v.paths.forEach { to.writeLong(it) }
      to.writeVarInt(v.polyline.numVertices())
      v.polyline.vertices().forEach {
        val latLng = LatLngE7.fromS2Point(it)
        to.writeInt(latLng.lat)
        to.writeInt(latLng.lng)
      }
    }
  })

  registerSerializer(TypeToken.of(TrailPolyline::class.java), object : Serializer<TrailPolyline> {
    override fun read(from: EncodedInputStream): TrailPolyline {
      val id = from.readLong()
      val polyline = ByteArray(from.readVarInt())
      from.read(polyline)
      return TrailPolyline(id, polyline)
    }

    override fun write(v: TrailPolyline, to: EncodedOutputStream) {
      to.writeLong(v.id)
      to.writeVarInt(v.polyline.size)
      to.write(v.polyline)
    }
  })

  var i = 0
  var epoch = -1
  val geofabrikSources = ArrayList<String>()
  var pbfPath = "./pbfs"
  var source = "geofabrik"
  while (i < args.size) {
    when (args[i]) {
      "--block_size" -> {
        FLUSH_THRESHOLD = args[i + 1].toInt()
        i += 1
      }
      "--buffer_size" -> {
        BUFFER_SIZE = args[i + 1].toInt()
        i += 1
      }
      "--epoch" -> {
        epoch = args[i + 1].toInt()
        i += 1
      }
      "--elevation_profiles" -> {
        ELEVATION_PROFILES_FILE = File(args[i + 1])
        i += 1
      }
      "--geofabrik_sources" -> {
        geofabrikSources.addAll(args[i + 1].split(","))
        i += 1
      }
      "--heap_dump_threshold" -> {
        HEAP_DUMP_THRESHOLD = args[i + 1].toLong()
        i += 1
      }
      "--pbf_path" -> {
        pbfPath = args[i + 1]
        i += 1
      }
      "--source" -> {
        source = args[i + 1]
        i += 1
      }
      else -> {
        throw RuntimeException("Unknown argument ${args[i]}")
      }
    }
    i += 1
  }

  return createConnectionSource(syncCommit = false).use { hikari ->
    when (source) {
      "geofabrik" -> {
        fetchGeofabrikSources(epoch, geofabrikSources, pbfPath)
      }
      "planet" -> {
        fetchPlanetSource(pbfPath)
      }
      else -> throw RuntimeException("Unknown type of source ${source}")
    }
  }
}

private fun fetchGeofabrikSources(
    maybeEpoch: Int,
    sources: List<String>,
    pbfPath: String): Pair<Int, List<Path>> {
  val epoch = if (maybeEpoch > 0) maybeEpoch else calculateEpoch()
  val paths = ArrayList<Path>()
  for (source in sources) {
    val pbfUrl = "https://download.geofabrik.de/${source}-${epoch}.osm.pbf".toHttpUrl()
    val pbf = Path.of(pbfPath, pbfUrl.pathSegments[pbfUrl.pathSize - 1])
    download(pbfUrl, pbf)
    paths.add(pbf)
  }

  return Pair(epoch, paths)
}

private fun fetchPlanetSource(pbfPath: String): Pair<Int, List<Path>> {
  val planet = Path.of(pbfPath, "planet-latest.osm.pbf")
  if (!planet.exists()) {
    throw RuntimeException("No such file ${planet}")
  }
  return Pair(calculateEpoch(), listOf(planet))
}

private fun calculateEpoch(): Int {
  val now = LocalDateTime.now(ZoneOffset.UTC)
  return if (now.hour >= 1 || now.minute >= 15) {
    // TODO(april): rollback month
    (now.year % 100) * 10000 + now.month.value * 100 + (now.dayOfMonth - 1)
  } else {
    throw RuntimeException("Don't do this")
  }
}
