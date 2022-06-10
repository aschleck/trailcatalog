package org.trailcatalog.importers

import com.google.common.reflect.TypeToken
import okhttp3.HttpUrl.Companion.toHttpUrl
import org.postgresql.jdbc.PgConnection
import org.trailcatalog.createConnectionSource
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
import org.trailcatalog.importers.pipeline.collections.Serializer
import org.trailcatalog.importers.pipeline.collections.registerSerializer
import org.trailcatalog.importers.pipeline.io.EncodedInputStream
import org.trailcatalog.importers.pipeline.io.EncodedOutputStream
import java.nio.file.Path
import java.sql.Connection
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

    override fun size(v: Boundary): Int {
      return 8 + 4 + 8 +
          EncodedOutputStream.varIntSize(v.name.length) +
          v.name.encodeToByteArray().size +
          EncodedOutputStream.varIntSize(v.s2Polygon.size) +
          v.s2Polygon.size
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

  registerSerializer(TypeToken.of(Trail::class.java), object : Serializer<Trail> {
    override fun read(from: EncodedInputStream): Trail {
      val id = from.readLong()
      val type = from.readInt()
      val cell = from.readLong()
      val name = ByteArray(from.readVarInt()).also {
        from.read(it)
      }.decodeToString()
      val paths = LongArray(from.readVarInt()).also { array ->
        for (i in 0 until array.size) {
          array[i] = from.readLong()
        }
      }
      val center = LatLngE7(from.readInt(), from.readInt())
      val lengthMeters = from.readDouble()
      return Trail(id, type, cell, name, paths, center, lengthMeters)
    }

    override fun size(v: Trail): Int {
      return 8 + 4 + 8 +
          EncodedOutputStream.varIntSize(v.name.length) +
          v.name.encodeToByteArray().size +
          EncodedOutputStream.varIntSize(v.paths.size) +
          8 * v.paths.size +
          4 + 4 + 8
    }

    override fun write(v: Trail, to: EncodedOutputStream) {
      to.writeLong(v.relationId)
      to.writeInt(v.type)
      to.writeLong(v.cell)
      val name = v.name.encodeToByteArray()
      to.writeVarInt(name.size)
      to.write(name)
      to.writeVarInt(v.paths.size)
      v.paths.forEach { to.writeLong(it) }
      to.writeInt(v.center.lat)
      to.writeInt(v.center.lng)
      to.writeDouble(v.lengthMeters)
    }
  })

  createConnectionSource(syncCommit = false).use { hikari ->
    hikari.connection.use { connection ->
      processPbfs(fetchSources(connection), connection.unwrap(PgConnection::class.java))
    }
  }
}

fun fetchSources(connection: Connection): Pair<Int, List<Path>> {
  val sources = ArrayList<String>()
  connection.prepareStatement("SELECT path FROM geofabrik_sources").executeQuery().use {
    while (it.next()) {
      sources.add(it.getString(1))
    }
  }

  val now = LocalDateTime.now(ZoneOffset.UTC)
  val epoch = if (now.hour >= 1 || now.minute >= 15) {
    // TODO(april): rollback month
    (now.year % 100) * 10000 + now.month.value * 100 + (now.dayOfMonth - 1)
  } else {
    throw RuntimeException("Don't do this")
  }

  val paths = ArrayList<Path>()
  for (source in sources) {
    val pbfUrl = "https://download.geofabrik.de/${source}-${epoch}.osm.pbf".toHttpUrl()
    val pbf = Path.of("pbfs", pbfUrl.pathSegments[pbfUrl.pathSize - 1])
    download(pbfUrl, pbf)
    paths.add(pbf)
  }

  return Pair(epoch, paths)
}

fun processPbfs(input: Pair<Int, List<Path>>, connection: PgConnection) {
  val (epoch, pbfs) = input

  val pipeline = Pipeline()
  val nodes =
      pipeline.cat(
          pbfs.map { p ->
            pipeline
                .read(PbfBlockReader(p))
                .then(ExtractNodes())
          })
      .groupBy("GroupNodes") { it.id }
  val ways =
      pipeline.cat(
          pbfs.map { p ->
            pipeline
                .read(PbfBlockReader(p))
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
  waysWithGeometry.write(DumpPaths(epoch, connection))
  val relations =
      pipeline.cat(
          pbfs.map { p ->
            pipeline
                .read(PbfBlockReader(p))
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
  relationsWithGeometry
      .then(CreateBoundaries())
      .write(DumpBoundaries(epoch, connection))
  relationsWithGeometry
      .then(CreateTrails())
      .write(DumpTrails(epoch, connection))

  pipeline.execute()
}
