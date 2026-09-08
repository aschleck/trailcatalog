package lat.trails

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.google.common.geometry.S1Angle
import com.google.common.geometry.S2CellId
import com.google.common.geometry.S2LatLng
import com.google.common.geometry.S2Polygon
import com.google.common.geometry.S2Polyline
import com.google.common.geometry.S2Projections
import com.google.protobuf.Message
import com.google.protobuf.util.JsonFormat
import com.zaxxer.hikari.HikariDataSource
import io.javalin.Javalin
import io.javalin.http.BadRequestResponse
import io.javalin.http.ConflictResponse
import io.javalin.http.Context
import io.javalin.http.Header
import io.javalin.http.HttpStatus
import io.javalin.http.NotFoundResponse
import io.javalin.http.UnauthorizedResponse
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.sql.Connection
import java.util.UUID
import kotlin.collections.ArrayList
import java.nio.charset.StandardCharsets
import lat.trails.common.createBaseConnection
import lat.trails.common.createTrailcatalogConnection
import lat.trails.common.encodeCovering
import lat.trails.proto.Collection
import lat.trails.proto.CreateCollectionRequest
import lat.trails.proto.CreateCollectionResponse
import lat.trails.proto.DeleteLineRequest
import lat.trails.proto.DeleteLineResponse
import lat.trails.proto.GetCollectionRequest
import lat.trails.proto.GetCollectionResponse
import lat.trails.proto.GetCurrentUserResponse
import lat.trails.proto.ListCollectionsResponse
import lat.trails.proto.PutLineRequest
import lat.trails.proto.PutLineResponse
import org.trailcatalog.common.AlignableByteArrayOutputStream
import org.trailcatalog.common.DelegatingEncodedOutputStream
import org.trailcatalog.common.DeltaInt64
import org.trailcatalog.common.DeltaLatLngE7
import org.trailcatalog.common.simplifyLatLngE7
import org.trailcatalog.flags.parseFlags
import org.trailcatalog.s2.polylineToCell
import org.trailcatalog.EpochTracker
import kotlin.use

private lateinit var epochTracker: EpochTracker
private lateinit var hikari: HikariDataSource
private lateinit var hikariTrailcatalog: HikariDataSource

private val ANONYMOUS_USER_ID = UUID.fromString("00000000-0000-0000-0000-000000000000")
private val TRAILCATALOG_PATHS_COLLECTIONS_ID = "00000000-0000-0000-0000-000000000001"

private val JSON_PARSER = JsonFormat.parser()
private val JSON_PRINTER = JsonFormat.printer().omittingInsignificantWhitespace()

fun main(args: Array<String>) {
  parseFlags(args)

  hikari = createBaseConnection()
  hikariTrailcatalog = createTrailcatalogConnection()
  epochTracker = EpochTracker(hikariTrailcatalog)
  Javalin.create { config ->
    config.routes.post("/api/data", ::fetchData)
    config.routes.get("/api/collections/{id}/covering", ::fetchCollectionCovering)
    config.routes.get("/api/collections/{id}/objects/{cell}", ::fetchCollectionObjects)
  }.start(7051)
}

private fun fetchData(ctx: Context) {
  val mapper = ObjectMapper()
  val request = mapper.readTree(ctx.bodyInputStream())
  val responses = ArrayList<Any>()
  for (key in request.get("keys").elements()) {
    val method = key.get("method").asText() ?: throw IllegalArgumentException("Key has no method")
    val payload = key.get("request")
    val value = when (method) {
      "lat.trails.DataService/CreateCollection" ->
        createCollection(ctx, CreateCollectionRequest.newBuilder().mergeJson(payload).build())
      "lat.trails.DataService/DeleteLine" ->
        deleteLine(ctx, DeleteLineRequest.newBuilder().mergeJson(payload).build())
      "lat.trails.DataService/GetCollection" ->
        getCollection(ctx, GetCollectionRequest.newBuilder().mergeJson(payload).build())
      "lat.trails.DataService/GetCurrentUser" -> getCurrentUser(ctx)
      "lat.trails.DataService/ListCollections" -> listCollections(ctx)
      "lat.trails.DataService/PutLine" ->
        putLine(ctx, PutLineRequest.newBuilder().mergeJson(payload).build())
      else -> throw IllegalArgumentException("Unknown method $method")
    }

    responses.add(
        mapOf("kind" to "result", "value" to mapper.readTree(JSON_PRINTER.print(value))))
  }

  ctx.json(mapOf("values" to responses))
}

private fun getCurrentUser(ctx: Context): GetCurrentUserResponse {
  val response = GetCurrentUserResponse.newBuilder()
  // The frontend sets this header from the login cookie and always overwrites what the browser
  // sent, so an empty one is a signed out browser.
  val id = ctx.header("X-User-ID")
  if (id.isNullOrEmpty()) {
    return response.build()
  }

  hikari.connection.use { connection ->
    connection
        .prepareStatement(
            "SELECT id, display_name, picture_url FROM users WHERE id = ? AND enabled")
        .apply {
          setObject(1, UUID.fromString(id))
        }
        .executeQuery()
        .use { results ->
          if (!results.next()) {
            return response.build()
          }

          response.userBuilder
              .setId((results.getObject(1) as UUID).toString())
              .setDisplayName(results.getString(2))
          // Left unset rather than empty because the client treats any value as a usable URL.
          results.getString(3)?.let { response.userBuilder.setPictureUrl(it) }
        }
  }
  return response.build()
}

private fun listCollections(ctx: Context): ListCollectionsResponse {
  val response = ListCollectionsResponse.newBuilder()
  val creator = ctx.header("X-User-ID")
  if (creator.isNullOrEmpty()) {
    return response.build()
  }

  hikari.connection.use { connection ->
    connection
        .prepareStatement(
            "SELECT id, name, version FROM collections WHERE creator = ? ORDER BY created DESC")
        .apply {
          setObject(1, UUID.fromString(creator))
        }
        .executeQuery()
        .use { results ->
          while (results.next()) {
            response.addCollections(
                Collection.newBuilder()
                    .setId((results.getObject(1) as UUID).toString())
                    .setName(results.getString(2))
                    .setVersion(results.getLong(3)))
          }
        }
  }
  return response.build()
}

private fun getCollection(ctx: Context, request: GetCollectionRequest): GetCollectionResponse {
  val creator = requireUser(ctx)
  val id = parseUuid(request.id)
  val response = GetCollectionResponse.newBuilder()
  hikari.connection.use { connection ->
    connection
        .prepareStatement("SELECT name, version FROM collections WHERE id = ? AND creator = ?")
        .apply {
          setObject(1, id)
          setObject(2, creator)
        }
        .executeQuery()
        .use { results ->
          if (!results.next()) {
            throw NotFoundResponse()
          }

          response.collectionBuilder
              .setId(request.id)
              .setName(results.getString(1))
              .setVersion(results.getLong(2))
        }

    connection
        .prepareStatement(
            "SELECT id, data, lat_lng_degrees, elevation_centimeters, time_seconds, version "
                + "FROM lines "
                + "WHERE collection = ? AND deleted IS NULL")
        .apply {
          setObject(1, id)
        }
        .executeQuery()
        .use { results ->
          while (results.next()) {
            val line =
                response.addLinesBuilder()
                    .setId((results.getObject(1) as UUID).toString())
                    .setData(results.getString(2))
                    .setVersion(results.getLong(6))
            for (e7 in DeltaLatLngE7.decode(results.getBytes(3))) {
              line.addLatLngE7(e7)
            }
            results.getBytes(4)?.let { elevation ->
              for (centimeters in DeltaInt64.decode(elevation)) {
                line.addElevationCentimeters(centimeters.toInt())
              }
            }
            results.getBytes(5)?.let { time ->
              for (seconds in DeltaInt64.decode(time)) {
                line.addTimeSeconds(seconds)
              }
            }
          }
        }
  }
  return response.build()
}

private fun createCollection(
    ctx: Context, request: CreateCollectionRequest): CreateCollectionResponse {
  val creator = requireUser(ctx)
  if (request.name.isEmpty()) {
    throw BadRequestResponse("A collection needs a name")
  }

  val response = CreateCollectionResponse.newBuilder()
  hikari.connection.use { connection ->
    connection
        .prepareStatement(
            "INSERT INTO collections (id, creator, name, covering) "
                + "VALUES (gen_random_uuid(), ?, ?, ?) "
                + "RETURNING id")
        .apply {
          setObject(1, creator)
          setString(2, request.name)
          setBytes(3, encodeCovering(listOf()))
        }
        .executeQuery()
        .use { results ->
          results.next()
          response.collectionBuilder
              .setId((results.getObject(1) as UUID).toString())
              .setName(request.name)
              .setVersion(0)
        }
  }
  return response.build()
}

private fun putLine(ctx: Context, request: PutLineRequest): PutLineResponse {
  val creator = requireUser(ctx)
  val collection = parseUuid(request.collection)
  val line = request.line
  val id = parseUuid(line.id)
  if (line.latLngE7Count % 2 != 0) {
    throw BadRequestResponse("Points are interleaved lat then lng")
  }

  val pointCount = line.latLngE7Count / 2
  if (pointCount < 2) {
    throw BadRequestResponse("A line needs two points")
  }
  if (line.elevationCentimetersCount != 0 && line.elevationCentimetersCount != pointCount) {
    throw BadRequestResponse("Elevations have to be one per point")
  }
  if (line.timeSecondsCount != 0 && line.timeSecondsCount != pointCount) {
    throw BadRequestResponse("Times have to be one per point")
  }

  val latLngE7 = IntArray(line.latLngE7Count) { line.getLatLngE7(it) }
  val cell =
      polylineToCell(
          S2Polyline(
              List(pointCount) {
                S2LatLng.fromE7(latLngE7[2 * it], latLngE7[2 * it + 1]).toPoint()
              }))
  val elevation =
      if (line.elevationCentimetersCount > 0) {
        DeltaInt64.encode(LongArray(pointCount) { line.getElevationCentimeters(it).toLong() })
      } else {
        null
      }
  val time =
      if (line.timeSecondsCount > 0) {
        DeltaInt64.encode(LongArray(pointCount) { line.getTimeSeconds(it) })
      } else {
        null
      }
  val geometry = DeltaLatLngE7.encode(latLngE7)
  // jsonb rejects an empty string.
  val data = line.data.ifEmpty { "{}" }

  return transact { connection ->
    val target = lockForWrite(connection, collection, creator, id)
    val version = target.collectionVersion + 1
    // Check if the current version matches the client's version and reject it if not
    if ((target.lineVersion ?: 0L) != line.version || target.lineDeleted) {
      throw ConflictResponse("The line changed since it was read")
    }

    if (target.lineVersion != null) {
      connection
          .prepareStatement(
              "UPDATE lines "
                  + "SET cell = ?, data = ?::jsonb, lat_lng_degrees = ?, "
                  + "elevation_centimeters = ?, time_seconds = ?, version = ?, updated = NOW() "
                  + "WHERE id = ? AND collection = ?")
          .apply {
            setLong(1, cell.id())
            setString(2, data)
            setBytes(3, geometry)
            setBytes(4, elevation)
            setBytes(5, time)
            setLong(6, version)
            setObject(7, id)
            setObject(8, collection)
          }
          .executeUpdate()
    } else {
      connection
          .prepareStatement(
              "INSERT INTO lines "
                  + "(id, collection, cell, created, updated, data, lat_lng_degrees, "
                  + "elevation_centimeters, time_seconds, version) "
                  + "VALUES (?, ?, ?, NOW(), NOW(), ?::jsonb, ?, ?, ?, ?)")
          .apply {
            setObject(1, id)
            setObject(2, collection)
            setLong(3, cell.id())
            setString(4, data)
            setBytes(5, geometry)
            setBytes(6, elevation)
            setBytes(7, time)
            setLong(8, version)
          }
          .executeUpdate()
    }

    updateCovering(connection, collection, version)
    PutLineResponse.newBuilder().setVersion(version).build()
  }
}

private fun deleteLine(ctx: Context, request: DeleteLineRequest): DeleteLineResponse {
  val creator = requireUser(ctx)
  val collection = parseUuid(request.collection)
  val id = parseUuid(request.id)
  transact { connection ->
    val target = lockForWrite(connection, collection, creator, id)
    // Check if someone else already deleted this
    if (target.lineVersion == null || target.lineDeleted) {
      return@transact
    }
    // Check if the line has been updated since the user decided to delete
    if (target.lineVersion != request.baseVersion) {
      throw ConflictResponse("The line changed since it was read")
    }

    // Set the tombstone
    val version = target.collectionVersion + 1
    connection
        .prepareStatement(
            "UPDATE lines SET deleted = NOW(), updated = NOW(), version = ? "
                + "WHERE id = ? AND collection = ?")
        .apply {
          setLong(1, version)
          setObject(2, id)
          setObject(3, collection)
        }
        .executeUpdate()
    updateCovering(connection, collection, version)
  }
  return DeleteLineResponse.getDefaultInstance()
}

// A null version means we're writing a new line
private data class WriteTarget(
    val collectionVersion: Long, val lineVersion: Long?, val lineDeleted: Boolean)

// Holds the collection row until the transaction ends so we can go back and update covering after a
// geometry change.
//
// FOR UPDATE OF c because otherwise Postgres will not lock the nullable side of an outer join.
private fun lockForWrite(
    connection: Connection, collection: UUID, creator: UUID, line: UUID): WriteTarget {
  connection
      .prepareStatement(
          "SELECT c.version, l.version, l.deleted IS NOT NULL "
              + "FROM collections c "
              + "LEFT JOIN lines l ON l.collection = c.id AND l.id = ? "
              + "WHERE c.id = ? AND c.creator = ? "
              + "FOR UPDATE OF c")
      .apply {
        setObject(1, line)
        setObject(2, collection)
        setObject(3, creator)
      }
      .executeQuery()
      .use { results ->
        if (!results.next()) {
          throw NotFoundResponse()
        }
        return WriteTarget(
            results.getLong(1), results.getObject(2) as Long?, results.getBoolean(3))
      }
}

private fun updateCovering(connection: Connection, collection: UUID, version: Long) {
  val cells = ArrayList<S2CellId>()
  connection
      .prepareStatement(
          "SELECT cell FROM lines WHERE collection = ? AND deleted IS NULL "
              + "UNION ALL "
              + "SELECT cell FROM polygons WHERE collection = ?")
      .apply {
        setObject(1, collection)
        setObject(2, collection)
      }
      .executeQuery()
      .use { results ->
        while (results.next()) {
          cells.add(S2CellId(results.getLong(1)))
        }
      }

  connection
      .prepareStatement("UPDATE collections SET covering = ?, version = ? WHERE id = ?")
      .apply {
        setBytes(1, encodeCovering(cells))
        setLong(2, version)
        setObject(3, collection)
      }
      .executeUpdate()
}

private fun parseUuid(id: String): UUID {
  try {
    return UUID.fromString(id)
  } catch (e: IllegalArgumentException) {
    throw BadRequestResponse("$id is not a UUID")
  }
}

// An empty header is a signed out browser, see getCurrentUser.
private fun requireUser(ctx: Context): UUID {
  val id = ctx.header("X-User-ID")
  if (id.isNullOrEmpty()) {
    throw UnauthorizedResponse()
  }
  return UUID.fromString(id)
}

private fun <T> transact(block: (Connection) -> T): T {
  hikari.connection.use { connection ->
    connection.autoCommit = false
    try {
      val result = block(connection)
      connection.commit()
      return result
    } catch (e: Throwable) {
      connection.rollback()
      throw e
    }
  }
}

private fun <B : Message.Builder> B.mergeJson(json: JsonNode?): B {
  if (json != null && !json.isNull) {
    JSON_PARSER.merge(json.toString(), this)
  }
  return this
}

private data class WireLine(val id: UUID, val data: String, val latLngDegrees: ByteArray)

private data class WirePolygon(val id: UUID, val data: String, val s2Polygon: ByteArray)

private fun fetchCollectionCovering(ctx: Context) {
  val allowed = arrayListOf(ANONYMOUS_USER_ID)
  ctx.header("X-User-ID").let {
    if (!it.isNullOrEmpty()) {
      allowed.add(UUID.fromString(it))
    }
  }

  // Revalidate this one response, because it is what tells a client the collection version.
  // Everything it points at is immutable, see cacheAndCheckIfCached.
  ctx.header("Cache-Control", "no-cache,private")

  val collection = ctx.pathParam("id")
  val bytes = AlignableByteArrayOutputStream()
  DelegatingEncodedOutputStream(bytes).use {
    // version
    it.writeVarInt(2)

    // collection version, then covering
    if (collection == TRAILCATALOG_PATHS_COLLECTIONS_ID) {
      // The epoch is the version: the paths a tile holds only change when an import lands.
      it.writeVarLong(epochTracker.epoch.toLong())

      val covering = ByteArrayOutputStream().use {
        DelegatingEncodedOutputStream(it).use {
          it.writeVarInt(1)
          it.writeVarInt(S2CellId.FACE_CELLS.size)
          S2CellId.FACE_CELLS.forEach { id -> it.writeLong(id.id()) }
        }
        it.toByteArray()
      }
      it.writeVarInt(covering.size)
      it.write(covering)
    } else {
      hikari.connection.use { connection ->
        connection
          .prepareStatement(
            "SELECT c.covering, c.version "
                    + "FROM collections c "
                    + "WHERE "
                    + "c.id = ? AND "
                    + "c.creator = ANY (?)"
          )
          .apply {
            setObject(1, UUID.fromString(collection))
            setArray(2, connection.createArrayOf("UUID", arrayOf(allowed.toArray())))
          }
          .executeQuery()
          .use { results ->
            if (!results.next()) {
              ctx.status(HttpStatus.NOT_FOUND)
              return@fetchCollectionCovering
            }

            it.writeVarLong(results.getLong(2))
            val covering = results.getBytes(1)
            it.writeVarInt(covering.size)
            it.write(covering)
          }
      }
    }
  }
  ctx.result(bytes.toByteArray())
}

private fun fetchCollectionObjects(ctx: Context) {
  val allowed = arrayListOf(ANONYMOUS_USER_ID)
  ctx.header("X-User-ID").let {
    if (!it.isNullOrEmpty()) {
      allowed.add(UUID.fromString(it))
    }
  }

  val collection = ctx.pathParam("id")
  val trailcatalogPaths = collection == TRAILCATALOG_PATHS_COLLECTIONS_ID
  // A collection nobody can read has no version to match, so it falls through to the queries below
  // and answers empty the way it always has.
  val currentVersion =
      if (trailcatalogPaths) {
        epochTracker.epoch.toLong()
      } else {
        collectionVersion(collection, allowed) ?: NO_VERSION
      }
  // Checked before the object queries run, or else a revalidation costs everything a miss does.
  val requestedVersion = ctx.queryParam("version")?.toLong()
  if (cacheAndCheckIfCached(ctx, requestedVersion, currentVersion, trailcatalogPaths)) {
    return
  }

  val cell = S2CellId.fromToken(ctx.pathParam("cell"))
  val bytes = AlignableByteArrayOutputStream()
  val indexBottom = ctx.queryParam("bottom")!!.toInt()
  val snap = ctx.queryParam("snap")?.toInt()
  // Streams split the objects by the level of the cell they were assigned to, so that no two tiles
  // carry the same object. The lowest set bit of a cell id is 4^(30 - level), so a level range is a
  // range on that bit, backwards: a coarser cell has a higher bit.
  val levelFloor = ctx.queryParam("maxLevel")?.toInt()?.let { 1L shl (2 * (30 - it)) }
  val levelCeiling = ctx.queryParam("minLevel")?.toInt()?.let { 1L shl (2 * (30 - it)) }
  DelegatingEncodedOutputStream(bytes).use {
    // version
    it.writeVarInt(1)

    if (trailcatalogPaths) {
      fetchTrailcatalogPaths(it, cell, indexBottom, levelCeiling, levelFloor, snap)
    } else {
      fetchRealCollection(
          it, allowed, cell, collection, indexBottom, levelCeiling, levelFloor, snap)
    }
  }

  ctx.result(bytes.toByteArray())
}

private fun fetchRealCollection(
  it: DelegatingEncodedOutputStream,
  allowed: ArrayList<UUID>,
  cell: S2CellId,
  collection: String,
  indexBottom: Int,
  levelCeiling: Long?,
  levelFloor: Long?,
  snap: Int?,
) {
  hikari.connection.use { connection ->
    val single = cell.level() < indexBottom

    // lines
    connection
      .prepareStatement(
        "SELECT l.id, l.data, l.lat_lng_degrees "
                + "FROM collections c "
                + "JOIN lines l ON c.id = l.collection "
                + "WHERE "
                + "c.id = ? AND "
                + "c.creator = ANY (?) AND "
                + "l.deleted IS NULL AND "
                + (if (single) "l.cell = ? " else "(l.cell >= ? AND l.cell <= ?) ")
                + (if (levelFloor != null) "AND (l.cell & -l.cell) >= ? " else "")
                + (if (levelCeiling != null) "AND (l.cell & -l.cell) <= ? " else "")
      )
      .apply {
        setObject(1, UUID.fromString(collection))
        setArray(2, connection.createArrayOf("UUID", arrayOf(allowed.toArray())))
        if (single) {
          setLong(3, cell.id())
        } else {
          setLong(3, cell.rangeMin().id())
          setLong(4, cell.rangeMax().id())
        }
        var index = if (single) 4 else 5
        if (levelFloor != null) {
          setLong(index++, levelFloor)
        }
        if (levelCeiling != null) {
          setLong(index, levelCeiling)
        }
      }
      .executeQuery()
      .use { results ->
        val lines = ArrayList<WireLine>()
        while (results.next()) {
          lines.add(
            WireLine(
              results.getObject(1) as UUID,
              results.getString(2),
              simplifyForSnap(results.getBytes(3), snap)
            )
          )
        }
        it.writeVarInt(lines.size)
        for (line in lines) {
          it.writeLong(line.id.leastSignificantBits)
          it.writeLong(line.id.mostSignificantBits)
          line.data.toByteArray(StandardCharsets.UTF_8).let { utf8 ->
            it.writeVarInt(utf8.size)
            it.write(utf8)
          }
          // DeltaLatLngE7 leads with its own point count and needs no alignment, so the geometry
          // goes to the wire in the encoding it is stored in.
          it.write(line.latLngDegrees)
        }
      }

    // polygons
    connection
      .prepareStatement(
        "SELECT p.id, p.data, p.s2_polygon "
                + "FROM collections c "
                + "JOIN polygons p ON c.id = p.collection "
                + "WHERE "
                + "c.id = ? AND "
                + "c.creator = ANY (?) AND "
                + (if (single) "p.cell = ? " else "(p.cell >= ? AND p.cell <= ?) ")
                + (if (levelFloor != null) "AND (p.cell & -p.cell) >= ? " else "")
                + (if (levelCeiling != null) "AND (p.cell & -p.cell) <= ? " else "")
      )
      .apply {
        setObject(1, UUID.fromString(collection))
        setArray(2, connection.createArrayOf("UUID", arrayOf(allowed.toArray())))
        if (single) {
          setLong(3, cell.id())
        } else {
          setLong(3, cell.rangeMin().id())
          setLong(4, cell.rangeMax().id())
        }
        var index = if (single) 4 else 5
        if (levelFloor != null) {
          setLong(index++, levelFloor)
        }
        if (levelCeiling != null) {
          setLong(index, levelCeiling)
        }
      }
      .executeQuery()
      .use { results ->
        val polygons = ArrayList<WirePolygon>()
        while (results.next()) {
          val raw = results.getBytes(3)
          val simplified =
            if (snap == null) {
              raw
            } else {
              S2Polygon().apply {
                initToSimplified(
                  S2Polygon.decode(ByteArrayInputStream(raw)),
                  S1Angle.radians(S2Projections.MAX_DIAG.getValue(snap) / 2.0 + 1e-15),
                  /* snapToCellCenters= */ false
                )
              }.let {
                val output = ByteArrayOutputStream()
                it.encode(output)
                output.toByteArray()
              }
            }
          polygons.add(
            WirePolygon(
              results.getObject(1) as UUID,
              results.getString(2),
              simplified
            )
          )
        }
        it.writeVarInt(polygons.size)
        for (polygon in polygons) {
          it.writeLong(polygon.id.leastSignificantBits)
          it.writeLong(polygon.id.mostSignificantBits)
          polygon.data.toByteArray(StandardCharsets.UTF_8).let { utf8 ->
            it.writeVarInt(utf8.size)
            it.write(utf8)
          }
          it.writeVarInt(polygon.s2Polygon.size)
          it.write(polygon.s2Polygon)
        }
      }
  }
}

private fun fetchTrailcatalogPaths(
  it: DelegatingEncodedOutputStream,
  cell: S2CellId,
  indexBottom: Int,
  levelCeiling: Long?,
  levelFloor: Long?,
  snap: Int?,
) {
  val epoch = epochTracker.epoch
  hikariTrailcatalog.connection.use { connection ->
    val single = cell.level() < indexBottom

    // lines
    connection
      .prepareStatement(
        "SELECT p.id, p.type, p.lat_lng_degrees, p.source_way "
                + "FROM paths p "
                + "WHERE "
                + "p.epoch = ? AND "
                + (if (single) "p.cell = ? " else "(p.cell >= ? AND p.cell <= ?) ")
                + (if (levelFloor != null) "AND (p.cell & -p.cell) >= ? " else "")
                + (if (levelCeiling != null) "AND (p.cell & -p.cell) <= ? " else "")
      )
      .apply {
        setInt(1, epoch)
        if (single) {
          setLong(2, cell.id())
        } else {
          setLong(2, cell.rangeMin().id())
          setLong(3, cell.rangeMax().id())
        }
        var index = if (single) 3 else 4
        if (levelFloor != null) {
          setLong(index++, levelFloor)
        }
        if (levelCeiling != null) {
          setLong(index, levelCeiling)
        }
      }
      .executeQuery()
      .use { results ->
        val lines = ArrayList<WireLine>()
        while (results.next()) {
          lines.add(
            WireLine(
              UUID(0,results.getLong(1)),
              "{\"id\":${results.getLong(4)},\"type\":${results.getInt(2)}}",
              simplifyForSnap(results.getBytes(3), snap)
            )
          )
        }
        it.writeVarInt(lines.size)
        for (line in lines) {
          it.writeLong(line.id.leastSignificantBits)
          it.writeLong(line.id.mostSignificantBits)
          line.data.toByteArray(StandardCharsets.UTF_8).let { utf8 ->
            it.writeVarInt(utf8.size)
            it.write(utf8)
          }
          // DeltaLatLngE7 leads with its own point count and needs no alignment, so the geometry
          // goes to the wire in the encoding it is stored in.
          it.write(line.latLngDegrees)
        }
      }

    // polygons
    it.writeVarInt(0)
  }
}

// Lets the browser and the CDN hold a tile until the collection version changes, because the object
// URL names that version and so can never go stale under its own key.
//
// Only the trailcatalog paths collection is public. Every other collection answers from the
// requesting user's own rows, so it may only ever land in that browser's cache.
private fun cacheAndCheckIfCached(
    ctx: Context, requested: Long?, current: Long, public: Boolean): Boolean {
  // Require the request to name the version it is about to get. A client asking for an older one
  // still gets the current objects, and marking those immutable under the old key would pin them
  // past the edit that replaced them.
  if (requested != null && requested == current) {
    ctx.header(
        "Cache-Control", (if (public) "public" else "private") + ",max-age=31536000,immutable")
  } else {
    ctx.header("Cache-Control", "no-cache,private")
  }

  "\"${current}\"".let { etag ->
    ctx.header("ETag", etag)
    val requestETag = ctx.header(Header.IF_NONE_MATCH)
    // nginx weakens etags when gzipping, so we have to also check if the user sent us a weak etag.
    if (etag == requestETag || "W/${etag}" == requestETag) {
      ctx.status(HttpStatus.NOT_MODIFIED)
      return true
    }
  }
  return false
}

// Never matches what a client asks for, because no collection has a negative version.
private const val NO_VERSION = -1L

private fun collectionVersion(collection: String, allowed: ArrayList<UUID>): Long? {
  hikari.connection.use { connection ->
    connection
        .prepareStatement("SELECT version FROM collections WHERE id = ? AND creator = ANY (?)")
        .apply {
          setObject(1, UUID.fromString(collection))
          setArray(2, connection.createArrayOf("UUID", arrayOf(allowed.toArray())))
        }
        .executeQuery()
        .use { results ->
          return if (results.next()) results.getLong(1) else null
        }
  }
}

// Drops the vertices a chord across them already clears, which is most of them: consecutive OSM
// nodes on a path sit about 15 meters apart and a pixel at zoom 12 is 38 meters.
private fun simplifyForSnap(latLngDegrees: ByteArray, snap: Int?): ByteArray {
  if (snap == null) {
    return latLngDegrees
  }

  // Halve the cell diagonal to match what fetchRealCollection hands initToSimplified for polygons
  // at the same snap level. MAX_DIAG is in radians and a Mercator unit is pi radians.
  val epsilon = S2Projections.MAX_DIAG.getValue(snap) / 2.0 / Math.PI
  return DeltaLatLngE7.encode(simplifyLatLngE7(DeltaLatLngE7.decode(latLngDegrees), epsilon))
}
