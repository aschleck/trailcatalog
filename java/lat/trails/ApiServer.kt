package lat.trails

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.google.common.geometry.S1Angle
import com.google.common.geometry.S2CellId
import com.google.common.geometry.S2LatLng
import com.google.common.geometry.S2Polygon
import com.google.common.geometry.S2Polyline
import com.google.protobuf.Message
import com.google.protobuf.util.JsonFormat
import com.zaxxer.hikari.HikariDataSource
import io.javalin.Javalin
import io.javalin.http.BadRequestResponse
import io.javalin.http.ConflictResponse
import io.javalin.http.Context
import io.javalin.http.ForbiddenResponse
import io.javalin.http.Header
import io.javalin.http.HttpStatus
import io.javalin.http.NotFoundResponse
import io.javalin.http.UnauthorizedResponse
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.sql.Connection
import java.sql.Types
import java.util.UUID
import kotlin.collections.ArrayList
import java.nio.charset.StandardCharsets
import lat.trails.common.createBaseConnection
import lat.trails.common.createTrailcatalogConnection
import lat.trails.common.encodeCovering
import lat.trails.proto.Collection
import lat.trails.proto.CreateCollectionRequest
import lat.trails.proto.CreateCollectionResponse
import lat.trails.proto.Delete
import lat.trails.proto.FeatureKind
import lat.trails.proto.Folder
import lat.trails.proto.GetCollectionRequest
import lat.trails.proto.GetCollectionResponse
import lat.trails.proto.GetCurrentUserResponse
import lat.trails.proto.GetSharingRequest
import lat.trails.proto.GetSharingResponse
import lat.trails.proto.Line
import lat.trails.proto.ListCollectionsResponse
import lat.trails.proto.Point
import lat.trails.proto.Role
import lat.trails.proto.SaveRequest
import lat.trails.proto.SaveResponse
import lat.trails.proto.SetSharingRequest
import lat.trails.proto.SetSharingResponse
import lat.trails.proto.Sharing
import lat.trails.proto.Write
import org.trailcatalog.common.AlignableByteArrayOutputStream
import org.trailcatalog.common.DelegatingEncodedOutputStream
import org.trailcatalog.common.DeltaInt64
import org.trailcatalog.common.DeltaLatLngE7
import org.trailcatalog.common.simplifyLatLngE7
import org.trailcatalog.flags.FlagSpec
import org.trailcatalog.flags.createFlag
import org.trailcatalog.flags.parseFlags
import org.trailcatalog.s2.SimpleS2
import org.trailcatalog.s2.polylineToCell
import org.trailcatalog.s2.snapEpsilon
import org.trailcatalog.s2.snapRadians
import org.trailcatalog.EpochTracker
import kotlin.math.abs
import kotlin.use

@FlagSpec("port")
private val port = createFlag(7051)

private lateinit var epochTracker: EpochTracker
private lateinit var hikari: HikariDataSource
private lateinit var hikariTrailcatalog: HikariDataSource

private val ANONYMOUS_USER_ID = UUID.fromString("00000000-0000-0000-0000-000000000000")
private val TRAILCATALOG_PATHS_COLLECTIONS_ID = "00000000-0000-0000-0000-000000000001"

// How a tile encodes its objects. Keep in sync with collection_loader.ts#load.
//
// Pack the trailcatalog paths into three varints instead of a UUID and a JSON blob, saving about
// 46 bytes a line. They are rows in a table we own, so the id fits a varint and the only attributes
// are the source way and the category. A user collection needs the general form: its objects are
// identified by UUID and described by the jsonb its creator wrote.
private const val KIND_UUID_JSON = 0
private const val KIND_PACKED_PATH = 1

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
  }.start(port.value)
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
      "lat.trails.DataService/GetCollection" ->
        getCollection(ctx, GetCollectionRequest.newBuilder().mergeJson(payload).build())
      "lat.trails.DataService/GetCurrentUser" -> getCurrentUser(ctx)
      "lat.trails.DataService/GetSharing" ->
        getSharing(ctx, GetSharingRequest.newBuilder().mergeJson(payload).build())
      "lat.trails.DataService/ListCollections" -> listCollections(ctx)
      "lat.trails.DataService/Save" ->
        save(ctx, SaveRequest.newBuilder().mergeJson(payload).build())
      "lat.trails.DataService/SetSharing" ->
        setSharing(ctx, SetSharingRequest.newBuilder().mergeJson(payload).build())
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
  val user = optionalUser(ctx) ?: return response.build()

  hikari.connection.use { connection ->
    connection
        .prepareStatement(
            "SELECT id, name, version FROM collections WHERE creator = ? ORDER BY created DESC")
        .apply {
          setObject(1, user)
        }
        .executeQuery()
        .use { results ->
          while (results.next()) {
            response.addCollections(
                Collection.newBuilder()
                    .setId((results.getObject(1) as UUID).toString())
                    .setName(results.getString(2))
                    .setVersion(results.getLong(3))
                    .setRole(Role.ROLE_OWNER))
          }
        }

    connection
        .prepareStatement(
            "SELECT c.id, c.name, c.version, g.role "
                + "FROM collection_grants g "
                + "JOIN collections c ON c.id = g.collection_id "
                + "WHERE g.grantee_id = ? "
                + "ORDER BY c.created DESC")
        .apply {
          setObject(1, user)
        }
        .executeQuery()
        .use { results ->
          while (results.next()) {
            response.addShared(
                Collection.newBuilder()
                    .setId((results.getObject(1) as UUID).toString())
                    .setName(results.getString(2))
                    .setVersion(results.getLong(3))
                    .setRole(parseRole(results.getString(4))))
          }
        }
  }
  return response.build()
}

private fun getCollection(ctx: Context, request: GetCollectionRequest): GetCollectionResponse {
  val id = parseUuid(request.id)
  val response = GetCollectionResponse.newBuilder()
  hikari.connection.use { connection ->
    val access = accessTo(connection, id, optionalUser(ctx)) ?: throw NotFoundResponse()
    response.collectionBuilder
        .setId(request.id)
        .setName(access.name)
        .setVersion(access.version)
        .setRole(access.role)

    connection
        .prepareStatement(
            "SELECT id, data, version FROM folders WHERE collection = ? AND deleted IS NULL")
        .apply {
          setObject(1, id)
        }
        .executeQuery()
        .use { results ->
          while (results.next()) {
            response.addFoldersBuilder()
                .setId((results.getObject(1) as UUID).toString())
                .setData(results.getString(2))
                .setVersion(results.getLong(3))
          }
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

    connection
        .prepareStatement(
            "SELECT id, data, lat_lng_degrees, elevation_centimeters, version "
                + "FROM points "
                + "WHERE collection = ? AND deleted IS NULL")
        .apply {
          setObject(1, id)
        }
        .executeQuery()
        .use { results ->
          while (results.next()) {
            val latLngE7 = DeltaLatLngE7.decode(results.getBytes(3))
            val point =
                response.addPointsBuilder()
                    .setId((results.getObject(1) as UUID).toString())
                    .setData(results.getString(2))
                    .setLatE7(latLngE7[0])
                    .setLngE7(latLngE7[1])
                    .setVersion(results.getLong(5))
            val elevation = results.getInt(4)
            if (!results.wasNull()) {
              point.setElevationCentimeters(elevation)
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
              .setRole(Role.ROLE_OWNER)
        }
  }
  return response.build()
}

private fun getSharing(ctx: Context, request: GetSharingRequest): GetSharingResponse {
  val user = requireUser(ctx)
  val collection = parseUuid(request.collectionId)
  hikari.connection.use { connection ->
    val access = accessTo(connection, collection, user) ?: throw NotFoundResponse()
    if (access.role != Role.ROLE_OWNER) {
      throw ForbiddenResponse()
    }
    return GetSharingResponse.newBuilder().setSharing(readSharing(connection, collection)).build()
  }
}

private fun setSharing(ctx: Context, request: SetSharingRequest): SetSharingResponse {
  val user = requireUser(ctx)
  val collection = parseUuid(request.collectionId)
  val roles = HashMap<String, String>()
  for (grant in request.sharing.grantsList) {
    val email = grant.email.trim().lowercase()
    val role =
        when (grant.role) {
          Role.ROLE_READ -> "read"
          Role.ROLE_WRITE -> "write"
          else -> throw BadRequestResponse("${grant.email} needs a role of read or write")
        }
    if (roles.put(email, role) != null) {
      throw BadRequestResponse("$email is listed twice")
    }
  }

  return transact { connection ->
    val owner =
        connection
            .prepareStatement("SELECT creator FROM collections WHERE id = ? FOR UPDATE")
            .apply {
              setObject(1, collection)
            }
            .executeQuery()
            .use { results ->
              if (!results.next()) {
                throw NotFoundResponse()
              }
              results.getObject(1) as UUID
            }
    if (owner != user) {
      throw if (accessTo(connection, collection, user) == null) NotFoundResponse()
          else ForbiddenResponse()
    }

    val ids = HashMap<String, UUID>()
    connection
        .prepareStatement("SELECT email, id FROM users WHERE email = ANY (?) AND enabled")
        .apply {
          setArray(1, connection.createArrayOf("TEXT", roles.keys.toTypedArray()))
        }
        .executeQuery()
        .use { results ->
          while (results.next()) {
            ids[results.getString(1)] = results.getObject(2) as UUID
          }
        }
    val unknown = roles.keys.filter { it !in ids }.sorted()
    if (unknown.isNotEmpty()) {
      return@transact SetSharingResponse.newBuilder().addAllUnknownEmails(unknown).build()
    }

    connection
        .prepareStatement("DELETE FROM collection_grants WHERE collection_id = ?")
        .apply {
          setObject(1, collection)
        }
        .executeUpdate()
    connection
        .prepareStatement(
            "INSERT INTO collection_grants (collection_id, grantee_id, role) VALUES (?, ?, ?)")
        .use { insert ->
          val grants = roles.map { (email, role) -> ids.getValue(email) to role }.toMutableList()
          grants.removeAll { it.first == owner }
          if (request.sharing.anyoneCanView) {
            grants.add(ANONYMOUS_USER_ID to "read")
          }
          for ((grantee, role) in grants) {
            insert.setObject(1, collection)
            insert.setObject(2, grantee)
            insert.setString(3, role)
            insert.addBatch()
          }
          insert.executeBatch()
        }

    SetSharingResponse.newBuilder().setSharing(readSharing(connection, collection)).build()
  }
}

private fun readSharing(connection: Connection, collection: UUID): Sharing {
  val sharing = Sharing.newBuilder()
  connection
      .prepareStatement(
          "SELECT g.grantee_id, u.email, g.role "
              + "FROM collection_grants g "
              + "JOIN users u ON u.id = g.grantee_id "
              + "WHERE g.collection_id = ? "
              + "ORDER BY u.email")
      .apply {
        setObject(1, collection)
      }
      .executeQuery()
      .use { results ->
        while (results.next()) {
          if (results.getObject(1) == ANONYMOUS_USER_ID) {
            sharing.anyoneCanView = true
          } else {
            sharing.addGrantsBuilder()
                .setEmail(results.getString(2))
                .setRole(parseRole(results.getString(3)))
          }
        }
      }
  return sharing.build()
}

private fun save(ctx: Context, request: SaveRequest): SaveResponse {
  val user = requireUser(ctx)
  val collection = parseUuid(request.collectionId)
  // Validated and encoded up front so that a bad write fails before we take the collection lock.
  val writes = request.writesList.map { prepareWrite(it) }
  val seen = HashSet<Pair<Table, UUID>>()
  for (write in writes) {
    // The version check reads what the batch already wrote, so a second write to the same feature
    // would always look stale.
    if (!seen.add(write.table to write.id)) {
      throw BadRequestResponse("${write.id} is written twice")
    }
  }

  return transact { connection ->
    val version = lockCollection(connection, collection, user).version + 1
    for (write in writes) {
      write.apply(connection, collection, version)
    }
    updateCovering(connection, collection, version)
    SaveResponse.newBuilder().setVersion(version).build()
  }
}

private enum class Table(val sql: String) {
  FOLDERS("folders"),
  LINES("lines"),
  POINTS("points"),
}

private abstract class PreparedWrite(val table: Table, val id: UUID) {
  abstract fun apply(connection: Connection, collection: UUID, version: Long)
}

private fun prepareWrite(write: Write): PreparedWrite {
  return when (write.writeCase) {
    Write.WriteCase.PUT_FOLDER -> prepareFolder(write.putFolder)
    Write.WriteCase.PUT_LINE -> prepareLine(write.putLine)
    Write.WriteCase.PUT_POINT -> preparePoint(write.putPoint)
    Write.WriteCase.DELETE -> prepareDelete(write.delete)
    else -> throw BadRequestResponse("A write needs a feature")
  }
}

private fun prepareFolder(folder: Folder): PreparedWrite {
  val id = parseUuid(folder.id)
  val data = jsonbData(folder.data)

  return object : PreparedWrite(Table.FOLDERS, id) {
    override fun apply(connection: Connection, collection: UUID, version: Long) {
      checkPut(connection, table, collection, id, folder.version)
      connection
          .prepareStatement(
              "INSERT INTO folders (id, collection, created, updated, data, version) "
                  + "VALUES (?, ?, NOW(), NOW(), ?::jsonb, ?) "
                  + "ON CONFLICT (collection, id) DO UPDATE SET "
                  + "data = EXCLUDED.data, version = EXCLUDED.version, updated = NOW(), "
                  + "deleted = NULL")
          .apply {
            setObject(1, id)
            setObject(2, collection)
            setString(3, data)
            setLong(4, version)
          }
          .executeUpdate()
    }
  }
}

private fun prepareLine(line: Line): PreparedWrite {
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
  val data = jsonbData(line.data)

  return object : PreparedWrite(Table.LINES, id) {
    override fun apply(connection: Connection, collection: UUID, version: Long) {
      checkPut(connection, table, collection, id, line.version)
      connection
          .prepareStatement(
              "INSERT INTO lines "
                  + "(id, collection, cell, created, updated, data, lat_lng_degrees, "
                  + "elevation_centimeters, time_seconds, version) "
                  + "VALUES (?, ?, ?, NOW(), NOW(), ?::jsonb, ?, ?, ?, ?) "
                  + "ON CONFLICT (collection, id) DO UPDATE SET "
                  + "cell = EXCLUDED.cell, data = EXCLUDED.data, "
                  + "lat_lng_degrees = EXCLUDED.lat_lng_degrees, "
                  + "elevation_centimeters = EXCLUDED.elevation_centimeters, "
                  + "time_seconds = EXCLUDED.time_seconds, version = EXCLUDED.version, "
                  + "updated = NOW(), deleted = NULL")
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
  }
}

private fun preparePoint(point: Point): PreparedWrite {
  val id = parseUuid(point.id)
  if (abs(point.latE7) > 90_0000000 || abs(point.lngE7) > 180_0000000) {
    throw BadRequestResponse("${point.latE7},${point.lngE7} is not on the globe")
  }

  val cell =
      S2CellId.fromLatLng(S2LatLng.fromE7(point.latE7, point.lngE7))
          .parent(SimpleS2.HIGHEST_INDEX_LEVEL)
  val geometry = DeltaLatLngE7.encode(intArrayOf(point.latE7, point.lngE7))
  val data = jsonbData(point.data)

  return object : PreparedWrite(Table.POINTS, id) {
    override fun apply(connection: Connection, collection: UUID, version: Long) {
      checkPut(connection, table, collection, id, point.version)
      connection
          .prepareStatement(
              "INSERT INTO points "
                  + "(id, collection, cell, created, updated, data, lat_lng_degrees, "
                  + "elevation_centimeters, version) "
                  + "VALUES (?, ?, ?, NOW(), NOW(), ?::jsonb, ?, ?, ?) "
                  + "ON CONFLICT (collection, id) DO UPDATE SET "
                  + "cell = EXCLUDED.cell, data = EXCLUDED.data, "
                  + "lat_lng_degrees = EXCLUDED.lat_lng_degrees, "
                  + "elevation_centimeters = EXCLUDED.elevation_centimeters, "
                  + "version = EXCLUDED.version, updated = NOW(), deleted = NULL")
          .apply {
            setObject(1, id)
            setObject(2, collection)
            setLong(3, cell.id())
            setString(4, data)
            setBytes(5, geometry)
            if (point.hasElevationCentimeters()) {
              setInt(6, point.elevationCentimeters)
            } else {
              setNull(6, Types.INTEGER)
            }
            setLong(7, version)
          }
          .executeUpdate()
    }
  }
}

private fun prepareDelete(delete: Delete): PreparedWrite {
  val id = parseUuid(delete.id)
  val table =
      when (delete.kind) {
        FeatureKind.FEATURE_KIND_FOLDER -> Table.FOLDERS
        FeatureKind.FEATURE_KIND_LINE -> Table.LINES
        FeatureKind.FEATURE_KIND_POINT -> Table.POINTS
        else -> throw BadRequestResponse("A delete needs a kind")
      }

  return object : PreparedWrite(table, id) {
    override fun apply(connection: Connection, collection: UUID, version: Long) {
      val existing = readVersion(connection, table, collection, id)
      // Check if someone else already deleted this
      if (existing == null || existing.deleted) {
        return
      }
      // Check if the feature has been updated since the user decided to delete
      if (existing.version != delete.baseVersion) {
        throw ConflictResponse("${table.sql} $id changed since it was read")
      }
      if (table == Table.FOLDERS && folderHasChildren(connection, collection, id)) {
        throw ConflictResponse("Folder $id still has children")
      }

      // Set the tombstone
      connection
          .prepareStatement(
              "UPDATE ${table.sql} SET deleted = NOW(), updated = NOW(), version = ? "
                  + "WHERE id = ? AND collection = ?")
          .apply {
            setLong(1, version)
            setObject(2, id)
            setObject(3, collection)
          }
          .executeUpdate()
    }
  }
}

private data class ExistingVersion(val version: Long, val deleted: Boolean)

private fun readVersion(
    connection: Connection, table: Table, collection: UUID, id: UUID): ExistingVersion? {
  connection
      .prepareStatement(
          "SELECT version, deleted IS NOT NULL FROM ${table.sql} WHERE collection = ? AND id = ?")
      .apply {
        setObject(1, collection)
        setObject(2, id)
      }
      .executeQuery()
      .use { results ->
        return if (results.next()) {
          ExistingVersion(results.getLong(1), results.getBoolean(2))
        } else {
          null
        }
      }
}

// Rejects a put unless the client read the version the feature is at now. A tombstone keeps the
// version that deleted it, so a put at that version is the deleter undoing the delete, and anyone
// who read the feature before it was deleted is a 409.
private fun checkPut(
    connection: Connection, table: Table, collection: UUID, id: UUID, version: Long) {
  val existing = readVersion(connection, table, collection, id)
  if ((existing?.version ?: 0L) != version) {
    throw ConflictResponse("${table.sql} $id changed since it was read")
  }
}

private fun folderHasChildren(connection: Connection, collection: UUID, folder: UUID): Boolean {
  connection
      .prepareStatement(
          Table.entries.joinToString(" UNION ALL ", postfix = " LIMIT 1") {
            "SELECT 1 FROM ${it.sql} " +
                "WHERE collection = ? AND deleted IS NULL AND data->>'folder_id' = ?"
          })
      .apply {
        for (i in Table.entries.indices) {
          setObject(2 * i + 1, collection)
          setString(2 * i + 2, folder.toString())
        }
      }
      .executeQuery()
      .use { results ->
        return results.next()
      }
}

// jsonb rejects an empty string.
private fun jsonbData(data: String): String {
  return data.ifEmpty { "{}" }
}

// Holds the collection row until the transaction ends so we can go back and update covering after a
// geometry change, and so that concurrent saves to one collection apply one after the other.
private fun lockCollection(connection: Connection, collection: UUID, user: UUID): Access {
  connection
      .prepareStatement("SELECT 1 FROM collections WHERE id = ? FOR UPDATE")
      .apply {
        setObject(1, collection)
      }
      .executeQuery()
      .close()
  val access = accessTo(connection, collection, user) ?: throw NotFoundResponse()
  if (access.role != Role.ROLE_OWNER && access.role != Role.ROLE_WRITE) {
    throw ForbiddenResponse()
  }
  return access
}

private data class Access(val name: String, val version: Long, val role: Role)

// Answers null for a collection the user may not see, so that it looks the same as one that does
// not exist. A null user is signed out and sees what was shared with anyone.
//
// A collection the anonymous user created is public, which is how PublicAccess imports land.
private fun accessTo(connection: Connection, collection: UUID, user: UUID?): Access? {
  val grantees = if (user != null) arrayOf(ANONYMOUS_USER_ID, user) else arrayOf(ANONYMOUS_USER_ID)
  connection
      .prepareStatement(
          "SELECT c.name, c.version, c.creator, g.grantee_id, g.role "
              + "FROM collections c "
              + "LEFT JOIN collection_grants g "
              + "ON g.collection_id = c.id AND g.grantee_id = ANY (?) "
              + "WHERE c.id = ?")
      .apply {
        setArray(1, connection.createArrayOf("UUID", grantees))
        setObject(2, collection)
      }
      .executeQuery()
      .use { results ->
        var access: Access? = null
        while (results.next()) {
          val name = results.getString(1)
          val version = results.getLong(2)
          val creator = results.getObject(3) as UUID
          val grantee = results.getObject(4) as UUID?
          val role =
              when {
                user != null && creator == user -> Role.ROLE_OWNER
                grantee == null -> if (creator == ANONYMOUS_USER_ID) Role.ROLE_READ else null
                // Only a grant naming the user can write. The table refuses a write grant to
                // anyone too, but a stray one would otherwise open the collection to everybody.
                grantee != user -> Role.ROLE_READ
                else -> parseRole(results.getString(5))
              }
          if (role != null && (access == null || role.number > access.role.number)) {
            access = Access(name, version, role)
          }
        }
        return access
      }
}

private fun parseRole(role: String): Role {
  return when (role) {
    "read" -> Role.ROLE_READ
    "write" -> Role.ROLE_WRITE
    else -> throw IllegalStateException("Unknown role $role")
  }
}

private fun updateCovering(connection: Connection, collection: UUID, version: Long) {
  val cells = ArrayList<S2CellId>()
  connection
      .prepareStatement(
          "SELECT cell FROM lines WHERE collection = ? AND deleted IS NULL "
              + "UNION ALL "
              + "SELECT cell FROM points WHERE collection = ? AND deleted IS NULL "
              + "UNION ALL "
              + "SELECT cell FROM polygons WHERE collection = ?")
      .apply {
        setObject(1, collection)
        setObject(2, collection)
        setObject(3, collection)
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

private fun requireUser(ctx: Context): UUID {
  return optionalUser(ctx) ?: throw UnauthorizedResponse()
}

// An empty header is a signed out browser, see getCurrentUser.
private fun optionalUser(ctx: Context): UUID? {
  val id = ctx.header("X-User-ID")
  return if (id.isNullOrEmpty()) null else UUID.fromString(id)
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

private data class WirePath(
    val id: Long, val sourceWay: Long, val type: Int, val latLngDegrees: ByteArray)

private data class WirePolygon(val id: UUID, val data: String, val s2Polygon: ByteArray)

private fun fetchCollectionCovering(ctx: Context) {
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
        val id = parseUuid(collection)
        if (accessTo(connection, id, optionalUser(ctx)) == null) {
          ctx.status(HttpStatus.NOT_FOUND)
          return@fetchCollectionCovering
        }

        connection
          .prepareStatement("SELECT covering, version FROM collections WHERE id = ?")
          .apply {
            setObject(1, id)
          }
          .executeQuery()
          .use { results ->
            results.next()
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
  val collection = ctx.pathParam("id")
  val trailcatalogPaths = collection == TRAILCATALOG_PATHS_COLLECTIONS_ID
  // The object queries trust that this checked access, because they filter on nothing else.
  val currentVersion =
      if (trailcatalogPaths) {
        epochTracker.epoch.toLong()
      } else {
        hikari.connection.use { connection ->
          accessTo(connection, parseUuid(collection), optionalUser(ctx))?.version
        } ?: throw NotFoundResponse()
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
    it.writeVarInt(2)

    if (trailcatalogPaths) {
      it.writeVarInt(KIND_PACKED_PATH)
      fetchTrailcatalogPaths(it, cell, indexBottom, levelCeiling, levelFloor, snap)
    } else {
      it.writeVarInt(KIND_UUID_JSON)
      fetchRealCollection(it, cell, collection, indexBottom, levelCeiling, levelFloor, snap)
    }
  }

  ctx.result(bytes.toByteArray())
}

private fun fetchRealCollection(
  it: DelegatingEncodedOutputStream,
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
                + "FROM lines l "
                + "WHERE "
                + "l.collection = ? AND "
                + "l.deleted IS NULL AND "
                + (if (single) "l.cell = ? " else "(l.cell >= ? AND l.cell <= ?) ")
                + (if (levelFloor != null) "AND (l.cell & -l.cell) >= ? " else "")
                + (if (levelCeiling != null) "AND (l.cell & -l.cell) <= ? " else "")
      )
      .apply {
        setObject(1, UUID.fromString(collection))
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
                + "FROM polygons p "
                + "WHERE "
                + "p.collection = ? AND "
                + (if (single) "p.cell = ? " else "(p.cell >= ? AND p.cell <= ?) ")
                + (if (levelFloor != null) "AND (p.cell & -p.cell) >= ? " else "")
                + (if (levelCeiling != null) "AND (p.cell & -p.cell) <= ? " else "")
      )
      .apply {
        setObject(1, UUID.fromString(collection))
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
                  S1Angle.radians(snapRadians(snap) + 1e-15),
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
        val raw = ArrayList<WirePath>()
        while (results.next()) {
          raw.add(
            WirePath(
              results.getLong(1),
              results.getLong(4),
              results.getInt(2),
              results.getBytes(3)
            )
          )
        }
        val paths = simplifyPathsForSnap(raw, snap)
        it.writeVarInt(paths.size)
        for (path in paths) {
          it.writeVarLong(path.id)
          it.writeVarLong(path.sourceWay)
          it.writeVarInt(path.type)
          // DeltaLatLngE7 leads with its own point count and needs no alignment, so the geometry
          // goes to the wire in the encoding it is stored in.
          it.write(path.latLngDegrees)
        }
      }

    // polygons, which the paths table has none of
    it.writeVarInt(0)
  }
}

// Lets the browser and the CDN hold a tile until the collection version changes, because the object
// URL names that version and so can never go stale under its own key.
//
// Only the trailcatalog paths collection is public. Every other collection answers only if the
// requesting user may read it, and the owner can take that back, so it may only ever land in that
// browser's cache.
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

// Simplifies a tile's paths without dropping the vertices they share, or else a way running
// straight through a junction loses it and the client's router can no longer turn there.
//
// Two ways whose cells are both at or below the tile's level always meet in the same tile, because
// both cells contain the vertex they share and so one is an ancestor of the other. Junctions
// between streams, and with the ways above indexBottom that tile one cell at a time, cross tiles,
// so PathRouter joins those by distance.
private fun simplifyPathsForSnap(paths: List<WirePath>, snap: Int?): List<WirePath> {
  if (snap == null) {
    return paths
  }

  val decoded = paths.map { DeltaLatLngE7.decode(it.latLngDegrees) }
  val shared = sharedVertices(decoded)
  val epsilon = snapEpsilon(snap)
  return paths.mapIndexed { i, path ->
    val simplified =
        simplifyLatLngE7(decoded[i], epsilon) { lat, lng ->
          shared.binarySearch(packLatLngE7(lat, lng)) >= 0
        }
    path.copy(latLngDegrees = DeltaLatLngE7.encode(simplified))
  }
}

// Sorted, so that callers can binarySearch it. Sorting every vertex rather than counting them in a
// map because a dense tile holds millions and a map would box each one.
private fun sharedVertices(lines: List<IntArray>): LongArray {
  val all = LongArray(lines.sumOf { it.size / 2 })
  var at = 0
  for (line in lines) {
    for (i in 0 until line.size / 2) {
      all[at] = packLatLngE7(line[2 * i], line[2 * i + 1])
      at += 1
    }
  }
  all.sort()

  val shared = ArrayList<Long>()
  for (i in 1 until all.size) {
    if (all[i] == all[i - 1] && (shared.isEmpty() || shared.last() != all[i])) {
      shared.add(all[i])
    }
  }
  return shared.toLongArray()
}

private fun packLatLngE7(lat: Int, lng: Int): Long {
  return (lat.toLong() shl 32) or (lng.toLong() and 0xFFFFFFFFL)
}

// Drops the vertices a chord across them already clears, which is most of them: consecutive OSM
// nodes on a path sit about 15 meters apart and a pixel at zoom 12 is 38 meters.
private fun simplifyForSnap(latLngDegrees: ByteArray, snap: Int?): ByteArray {
  if (snap == null) {
    return latLngDegrees
  }

  return DeltaLatLngE7.encode(
      simplifyLatLngE7(DeltaLatLngE7.decode(latLngDegrees), snapEpsilon(snap)))
}
