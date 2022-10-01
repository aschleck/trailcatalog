package org.trailcatalog.importers

import com.google.common.geometry.S2Point
import com.google.common.geometry.S2Polyline
import com.google.common.reflect.TypeToken
import com.zaxxer.hikari.HikariDataSource
import okhttp3.HttpUrl.Companion.toHttpUrl
import org.postgresql.copy.CopyManager
import org.postgresql.jdbc.PgConnection
import org.trailcatalog.createConnectionSource
import org.trailcatalog.importers.common.download
import org.trailcatalog.importers.pipeline.groupBy
import org.trailcatalog.importers.pipeline.Pipeline
import org.trailcatalog.importers.pbf.ExtractNodeWayPairs
import org.trailcatalog.importers.pbf.ExtractNodes
import org.trailcatalog.importers.pbf.ExtractRelationGeometriesWithWays
import org.trailcatalog.importers.pbf.ExtractRelations
import org.trailcatalog.importers.pbf.ExtractWays
import org.trailcatalog.importers.pbf.GatherWayNodes
import org.trailcatalog.importers.pbf.ExtractWayRelationPairs
import org.trailcatalog.importers.pbf.GatherRelationWays
import org.trailcatalog.importers.pbf.LatLngE7
import org.trailcatalog.importers.pbf.MakeRelationGeometries
import org.trailcatalog.importers.pbf.MakeWayGeometries
import org.trailcatalog.importers.pbf.PbfBlockReader
import org.trailcatalog.importers.pbf.registerPbfSerializers
import org.trailcatalog.importers.pipeline.collections.HEAP_DUMP_THRESHOLD
import org.trailcatalog.importers.pipeline.collections.Serializer
import org.trailcatalog.importers.pipeline.collections.registerSerializer
import org.trailcatalog.importers.pipeline.io.EncodedInputStream
import org.trailcatalog.importers.pipeline.io.EncodedOutputStream
import org.trailcatalog.importers.pipeline.io.BUFFER_SIZE
import org.trailcatalog.importers.pipeline.io.FLUSH_THRESHOLD
import java.io.InputStream
import java.nio.file.Path
import java.time.LocalDateTime
import java.time.ZoneOffset

fun main(args: Array<String>) {
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
  var pbfPath = ""
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
      "--heap_dump_threshold" -> {
        HEAP_DUMP_THRESHOLD = args[i + 1].toInt()
        i += 1
      }
      "--pbf_path" -> {
        pbfPath = args[i + 1]
        i += 1
      }
      else -> {
        throw RuntimeException("Unknown argument ${args[i]}")
      }
    }
    i += 1
  }

  createConnectionSource(syncCommit = false).use { hikari ->
    processPbfs(fetchSources(epoch, pbfPath, hikari), hikari)
  }
}

fun fetchSources(
    maybeEpoch: Int, maybePbfPath: String, hikari: HikariDataSource): Pair<Int, List<Path>> {
  val sources = ArrayList<String>()
  hikari.connection.use { connection ->
    connection.prepareStatement("SELECT path FROM geofabrik_sources").executeQuery().use {
      while (it.next()) {
        sources.add(it.getString(1))
      }
    }
  }

  val now = LocalDateTime.now(ZoneOffset.UTC)
  val epoch = if (maybeEpoch > 0) {
    maybeEpoch
  } else if (now.hour >= 1 || now.minute >= 15) {
    // TODO(april): rollback month
    (now.year % 100) * 10000 + now.month.value * 100 + (now.dayOfMonth - 1)
  } else {
    throw RuntimeException("Don't do this")
  }

  val paths = ArrayList<Path>()
  for (source in sources) {
    val pbfUrl = "https://download.geofabrik.de/${source}-${epoch}.osm.pbf".toHttpUrl()
    val pbf =
        Path.of(
            if (maybePbfPath.isNotEmpty()) maybePbfPath else "pbfs",
            pbfUrl.pathSegments[pbfUrl.pathSize - 1])
    download(pbfUrl, pbf)
    paths.add(pbf)
  }

  return Pair(epoch, paths)
}

fun processPbfs(input: Pair<Int, List<Path>>, hikari: HikariDataSource) {
  val (epoch, pbfs) = input

  val pipeline = Pipeline()
  val nodes =
      pipeline.cat(
          pbfs.map { p ->
            pipeline
                .read(PbfBlockReader(p, readNodes = true, readRelations = false, readWays = false))
                .then(ExtractNodes())
          })
      .groupBy("GroupNodes") { it.id }
  val ways =
      pipeline.cat(
          pbfs.map { p ->
            pipeline
                .read(PbfBlockReader(p, readNodes = false, readRelations = false, readWays = true))
                .then(ExtractWays())
          })
      .groupBy("GroupWays") { it.id }
  val waysToPoints =
      pipeline
          .join2("JoinNodesForWayPoints", nodes, ways.then(ExtractNodeWayPairs()))
          .then(GatherWayNodes())
  val waysWithGeometry =
      pipeline
          .join2("JoinWaysForGeometry", ways, waysToPoints)
          .then(MakeWayGeometries())
  waysWithGeometry.write(DumpPaths(epoch, hikari))
  val relations =
      pipeline.cat(
          pbfs.map { p ->
            pipeline
                .read(PbfBlockReader(p, readNodes = false, readRelations = true, readWays = false))
                .then(ExtractRelations())
          })
          .groupBy("GroupRelations") { it.id }
  val relationsToGeometriesWithWays = relations.then(ExtractRelationGeometriesWithWays())
  val relationsToWayGeometries =
      pipeline
          .join2(
              "JoinOnWaysForRelationGeomeries",
              relationsToGeometriesWithWays.then(ExtractWayRelationPairs()),
              waysWithGeometry)
          .then(GatherRelationWays())
  val relationsGeometryById =
      pipeline
          .join2(
              "JoinRelationsForGeometry", relationsToGeometriesWithWays, relationsToWayGeometries)
          .then(MakeRelationGeometries())
  val relationsWithGeometry =
      pipeline.join2("JoinRelationsWithGeometry", relations, relationsGeometryById)
  val boundaries = relationsWithGeometry.then(CreateBoundaries())
  boundaries.write(DumpBoundaries(epoch, hikari))
  val trails = relationsWithGeometry.then(CreateTrails())
  trails.write(DumpPathsInTrails(epoch, hikari))
  trails.write(DumpTrails(epoch, hikari))
  val byCells = pipeline
      .join2(
          "JoinOnContainment",
          boundaries.then(GroupBoundariesByCell()),
          trails.then(GroupTrailsByCell()))
  byCells.then(CreateBoundariesInBoundaries()).write(DumpBoundariesInBoundaries(epoch, hikari))
  byCells.then(CreateTrailsInBoundaries()).write(DumpTrailsInBoundaries(epoch, hikari))

  pipeline.execute()

  hikari.connection.use {
    println("Updating epoch")
    it.prepareStatement("INSERT INTO active_epoch (epoch) VALUES (?)").apply {
      setInt(1, epoch)
    }.execute()
    println("Cleaning up old epochs")
    for (table in listOf(
        "active_epoch",
        "boundaries",
        "boundaries_in_boundaries",
        "paths",
        "paths_in_trails",
        "trails",
        "trails_in_boundaries",
    )) {
      it.prepareStatement("DELETE FROM ${table} WHERE epoch < ?").apply {
        setInt(1, epoch)
      }.execute()
    }
  }
}

fun copyStreamToPg(table: String, stream: InputStream, hikari: HikariDataSource) {
  hikari.connection.use { connection ->
    val pg = connection.unwrap(PgConnection::class.java)
    CopyManager(pg).copyIn("COPY ${table} FROM STDIN WITH CSV HEADER", stream)
  }
}
