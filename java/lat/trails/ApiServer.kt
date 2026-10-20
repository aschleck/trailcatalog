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
import io.javalin.http.HttpResponseException
import io.javalin.http.HttpStatus
import io.javalin.http.NotFoundResponse
import io.javalin.http.UnauthorizedResponse
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.sql.Connection
import java.sql.ResultSet
import java.security.SecureRandom
import java.sql.Types
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.Future
import kotlin.collections.ArrayList
import java.nio.charset.StandardCharsets
import lat.trails.common.assemblePolygon
import lat.trails.common.createBaseConnection
import lat.trails.common.createTrailcatalogConnection
import lat.trails.common.encodeCovering
import lat.trails.common.TIME_ZONES_COLLECTION_ID
import lat.trails.proto.AcceptInviteRequest
import lat.trails.proto.AcceptInviteResponse
import lat.trails.proto.Collection
import lat.trails.proto.CreateCollectionRequest
import lat.trails.proto.CreateCollectionResponse
import lat.trails.proto.CreateInviteRequest
import lat.trails.proto.CreateInviteResponse
import lat.trails.proto.Delete
import lat.trails.proto.DeleteCollectionRequest
import lat.trails.proto.DeleteCollectionResponse
import lat.trails.proto.FeatureKind
import lat.trails.proto.Folder
import lat.trails.proto.GetAviationWeatherRequest
import lat.trails.proto.GetCollectionRequest
import lat.trails.proto.GetCollectionResponse
import lat.trails.proto.GetCurrentUserResponse
import lat.trails.proto.GetInviteRequest
import lat.trails.proto.GetInviteResponse
import lat.trails.proto.GetOsmTagsRequest
import lat.trails.proto.GetOsmTagsResponse
import lat.trails.proto.GetSharingRequest
import lat.trails.proto.GetSharingResponse
import lat.trails.proto.GetTimeZoneRequest
import lat.trails.proto.GetTimeZoneResponse
import lat.trails.proto.Invite
import lat.trails.proto.Line
import lat.trails.proto.ListCollectionsResponse
import lat.trails.proto.OsmElementType
import lat.trails.proto.Point
import lat.trails.proto.Polygon
import lat.trails.proto.PutSchema
import lat.trails.proto.RevokeInviteRequest
import lat.trails.proto.RevokeInviteResponse
import lat.trails.proto.Role
import lat.trails.proto.SaveRequest
import lat.trails.proto.SaveResponse
import lat.trails.proto.SearchRequest
import lat.trails.proto.SetAnyoneCanViewRequest
import lat.trails.proto.SetAnyoneCanViewResponse
import lat.trails.proto.SetGrantRequest
import lat.trails.proto.SetGrantResponse
import lat.trails.proto.SetViewStateRequest
import lat.trails.proto.SetViewStateResponse
import lat.trails.proto.Sharing
import lat.trails.proto.UpdateCollectionRequest
import lat.trails.proto.UpdateCollectionResponse
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
import org.slf4j.LoggerFactory
import org.trailcatalog.EpochTracker
import kotlin.math.abs
import kotlin.use

@FlagSpec("port")
private val port = createFlag(7051)

private lateinit var epochTracker: EpochTracker
private lateinit var hikari: HikariDataSource
private lateinit var hikariTrailcatalog: HikariDataSource

private val logger = LoggerFactory.getLogger("ApiServer")
private val random = SecureRandom()

private val ANONYMOUS_USER_ID = UUID.fromString("00000000-0000-0000-0000-000000000000")
private val TRAILCATALOG_PATHS_COLLECTIONS_ID = "00000000-0000-0000-0000-000000000001"
private val TRAILCATALOG_POINTS_COLLECTIONS_ID = "00000000-0000-0000-0000-000000000002"

// How a tile encodes its objects. Keep in sync with collection_loader.ts#load.
//
// Pack the trailcatalog paths into three varints instead of a UUID and a JSON blob, saving about
// 46 bytes a line. They are rows in a table we own, so the id fits a varint and the only attributes
// are the source way and the category. A user collection needs the general form: its objects are
// identified by UUID and described by the jsonb its creator wrote.
//
// Points pack the same way, and carry their name because OSM names a node on the node.
private const val KIND_UUID_JSON = 0
private const val KIND_PACKED_PATH = 1
private const val KIND_PACKED_POINT = 2

// A batch from line_refiner.ts#BATCH. 128 ids at 37 characters each is 4.7 KB, under the 8 KB
// buffer nginx's large_client_header_buffers default holds a request line in.
private const val MAX_LINES_BY_ID = 128

private const val LINE_GEOMETRY_COLUMNS = "lat_lng_degrees, elevation_centimeters, time_seconds"
private const val POINT_GEOMETRY_COLUMNS = "lat_lng_degrees, elevation_centimeters"
private const val POLYGON_GEOMETRY_COLUMNS = "lat_lng_degrees"
// See parseInvite.
private const val INVITE_COLUMNS = "code, role, uses, expires"

private const val INVITE_CODE_ALPHABET =
    "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
// 62^8 is 2.2e14 codes, so guessing one of a thousand live invites at a thousand requests a second
// takes about 7 years.
private const val INVITE_CODE_CHARS = 8

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
    config.routes.get("/api/collections/{id}/lines", ::fetchCollectionLines)
  }.start(port.value)
}

// Keep in sync with data.ts#WRITES
private val WRITES =
    setOf(
        "lat.trails.DataService/AcceptInvite",
        "lat.trails.DataService/CreateCollection",
        "lat.trails.DataService/CreateInvite",
        "lat.trails.DataService/DeleteCollection",
        "lat.trails.DataService/RevokeInvite",
        "lat.trails.DataService/Save",
        "lat.trails.DataService/SetAnyoneCanView",
        "lat.trails.DataService/SetGrant",
        "lat.trails.DataService/SetViewState",
        "lat.trails.DataService/UpdateCollection",
    )

private val dispatcher = Executors.newVirtualThreadPerTaskExecutor()

// Runs the keys in parallel, except that a write waits for every key before it and every key
// after it waits for the write, so a read batched with a write still sees it.
private fun fetchData(ctx: Context) {
  val mapper = ObjectMapper()
  val request = mapper.readTree(ctx.bodyInputStream())
  val responses = ArrayList<Future<Any>>()
  var barrier = 0
  for (key in request.get("keys").elements()) {
    val method = key.get("method").asText() ?: throw IllegalArgumentException("Key has no method")
    val payload = key.get("request")
    val write = WRITES.contains(method)
    val before = if (write) responses.toList() else responses.subList(0, barrier).toList()
    responses.add(
        dispatcher.submit<Any> {
          before.forEach { it.get() }
          dispatchKey(ctx, mapper, method, payload)
        })
    if (write) {
      barrier = responses.size
    }
  }

  ctx.json(mapOf("values" to responses.map { it.get() }))
}

// Failed per key, because the server side render fails the whole page when the batch does.
private fun dispatchKey(
    ctx: Context, mapper: ObjectMapper, method: String, payload: JsonNode?): Any {
  val value = try {
    dispatch(ctx, method, payload)
  } catch (e: HttpResponseException) {
    return mapOf("kind" to "error", "code" to e.status, "message" to e.message)
  } catch (e: Exception) {
    logger.error("$method failed", e)
    return mapOf("kind" to "error", "code" to HttpStatus.INTERNAL_SERVER_ERROR.code)
  }
  return mapOf("kind" to "result", "value" to mapper.readTree(JSON_PRINTER.print(value)))
}

private fun dispatch(ctx: Context, method: String, payload: JsonNode?): Message {
  return when (method) {
    "lat.trails.DataService/AcceptInvite" ->
      acceptInvite(ctx, AcceptInviteRequest.newBuilder().mergeJson(payload).build())
    "lat.trails.DataService/CreateCollection" ->
      createCollection(ctx, CreateCollectionRequest.newBuilder().mergeJson(payload).build())
    "lat.trails.DataService/CreateInvite" ->
      createInvite(ctx, CreateInviteRequest.newBuilder().mergeJson(payload).build())
    "lat.trails.DataService/DeleteCollection" ->
      deleteCollection(ctx, DeleteCollectionRequest.newBuilder().mergeJson(payload).build())
    "lat.trails.DataService/GetAviationWeather" ->
      getAviationWeather(GetAviationWeatherRequest.newBuilder().mergeJson(payload).build())
    "lat.trails.DataService/GetCollection" ->
      getCollection(ctx, GetCollectionRequest.newBuilder().mergeJson(payload).build())
    "lat.trails.DataService/GetCurrentUser" -> getCurrentUser(ctx)
    "lat.trails.DataService/GetInvite" ->
      getInvite(ctx, GetInviteRequest.newBuilder().mergeJson(payload).build())
    "lat.trails.DataService/GetOsmTags" ->
      getOsmTags(GetOsmTagsRequest.newBuilder().mergeJson(payload).build())
    "lat.trails.DataService/GetSharing" ->
      getSharing(ctx, GetSharingRequest.newBuilder().mergeJson(payload).build())
    "lat.trails.DataService/GetTimeZone" ->
      getTimeZone(GetTimeZoneRequest.newBuilder().mergeJson(payload).build())
    "lat.trails.DataService/ListCollections" -> listCollections(ctx)
    "lat.trails.DataService/RevokeInvite" ->
      revokeInvite(ctx, RevokeInviteRequest.newBuilder().mergeJson(payload).build())
    "lat.trails.DataService/Save" ->
      save(ctx, SaveRequest.newBuilder().mergeJson(payload).build())
    "lat.trails.DataService/Search" ->
      hikariTrailcatalog.connection.use {
        search(SearchRequest.newBuilder().mergeJson(payload).build(), it, epochTracker.epoch)
      }
    "lat.trails.DataService/SetAnyoneCanView" ->
      setAnyoneCanView(ctx, SetAnyoneCanViewRequest.newBuilder().mergeJson(payload).build())
    "lat.trails.DataService/SetGrant" ->
      setGrant(ctx, SetGrantRequest.newBuilder().mergeJson(payload).build())
    "lat.trails.DataService/SetViewState" ->
      setViewState(ctx, SetViewStateRequest.newBuilder().mergeJson(payload).build())
    "lat.trails.DataService/UpdateCollection" ->
      updateCollection(ctx, UpdateCollectionRequest.newBuilder().mergeJson(payload).build())
    else -> throw IllegalArgumentException("Unknown method $method")
  }
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
  val user = optionalUser(ctx)
  val response = GetCollectionResponse.newBuilder()
  hikari.connection.use { connection ->
    val access = getCollectionAccess(connection, id, user) ?: throw NotFoundResponse()
    response.collectionBuilder
        .setId(request.id)
        .setName(access.name)
        .setVersion(access.version)
        .setRole(access.role)
        .setData(access.data)

    // Everyone else sees the owner's, including a viewer whose own row is from when they could
    // edit.
    val own = if (user != null && canEdit(access.role)) user else access.creator
    connection
        .prepareStatement(
            "SELECT hidden_feature_ids, layers FROM view_states "
                + "WHERE collection_id = ? AND user_id IN (?, ?) "
                + "ORDER BY user_id = ? DESC "
                + "LIMIT 1")
        .apply {
          setObject(1, id)
          setObject(2, own)
          setObject(3, access.creator)
          setObject(4, own)
        }
        .executeQuery()
        .use { results ->
          if (results.next()) {
            for (hidden in results.getArray(1).array as Array<*>) {
              response.addHiddenFeatureIds((hidden as UUID).toString())
            }
            response.setLayers(results.getString(2) ?: "")
          }
        }

    connection
        .prepareStatement("SELECT schema, schema_version FROM collections WHERE id = ?")
        .apply {
          setObject(1, id)
        }
        .executeQuery()
        .use { results ->
          if (results.next()) {
            response.setSchema(results.getString(1) ?: "")
            response.setSchemaVersion(results.getLong(2))
          }
        }

    fun geometry(columns: String) = if (request.omitGeometry) null else columns
    forEachFeature(
        connection,
        id,
        Table.FOLDERS,
        geometryColumns = null,
        add = { results ->
          response.addFoldersBuilder()
              .setId((results.getObject(1) as UUID).toString())
              .setData(results.getString(2))
              .setVersion(results.getLong(3))
        })

    forEachFeature(
        connection,
        id,
        Table.LINES,
        geometry(LINE_GEOMETRY_COLUMNS),
        add = { results ->
          response.addLinesBuilder()
              .setId((results.getObject(1) as UUID).toString())
              .setData(results.getString(2))
              .setVersion(results.getLong(3))
        }) { line, results ->
      for (e7 in DeltaLatLngE7.decode(results.getBytes(4))) {
        line.addLatLngE7(e7)
      }
      results.getBytes(5)?.let { elevation ->
        for (centimeters in DeltaInt64.decode(elevation)) {
          line.addElevationCentimeters(centimeters.toInt())
        }
      }
      results.getBytes(6)?.let { time ->
        for (seconds in DeltaInt64.decode(time)) {
          line.addTimeSeconds(seconds)
        }
      }
    }

    forEachFeature(
        connection,
        id,
        Table.POINTS,
        geometry(POINT_GEOMETRY_COLUMNS),
        add = { results ->
          response.addPointsBuilder()
              .setId((results.getObject(1) as UUID).toString())
              .setData(results.getString(2))
              .setVersion(results.getLong(3))
        }) { point, results ->
      val latLngE7 = DeltaLatLngE7.decode(results.getBytes(4))
      point.setLatE7(latLngE7[0]).setLngE7(latLngE7[1])
      val elevation = results.getInt(5)
      if (!results.wasNull()) {
        point.setElevationCentimeters(elevation)
      }
    }

    // An imported polygon has no ring to edit, see GetCollectionResponse#polygons.
    forEachFeature(
        connection,
        id,
        Table.POLYGONS,
        geometry(POLYGON_GEOMETRY_COLUMNS),
        where = "lat_lng_degrees IS NOT NULL",
        add = { results ->
          response.addPolygonsBuilder()
              .setId((results.getObject(1) as UUID).toString())
              .setData(results.getString(2))
              .setVersion(results.getLong(3))
        }) { polygon, results ->
      for (e7 in DeltaLatLngE7.decode(results.getBytes(4))) {
        polygon.addLatLngE7(e7)
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
  if (request.schema.isEmpty()) {
    throw BadRequestResponse("A collection needs a schema")
  }

  val response = CreateCollectionResponse.newBuilder()
  hikari.connection.use { connection ->
    connection
        .prepareStatement(
            "INSERT INTO collections (id, creator, name, covering, schema) "
                + "VALUES (gen_random_uuid(), ?, ?, ?, ?::jsonb) "
                + "RETURNING id")
        .apply {
          setObject(1, creator)
          setString(2, request.name)
          setBytes(3, encodeCovering(listOf()))
          setString(4, request.schema)
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

private fun updateCollection(
    ctx: Context, request: UpdateCollectionRequest): UpdateCollectionResponse {
  val user = requireUser(ctx)
  val collection = parseUuid(request.id)
  val name = if (request.hasName()) request.name.trim() else null
  if (name?.isEmpty() == true) {
    throw BadRequestResponse("A collection needs a name")
  }
  val data = request.data.ifEmpty { "{}" }
  if (!ObjectMapper().readTree(data).isObject) {
    throw BadRequestResponse("Collection data must be an object")
  }

  return transact { connection ->
    val access = lockEditableCollection(connection, collection, user)
    connection
        .prepareStatement(
            "UPDATE collections "
                + "SET name = COALESCE(?, name), data = jsonb_strip_nulls(data || ?::jsonb) "
                + "WHERE id = ? "
                + "RETURNING name, data")
        .apply {
          setString(1, name)
          setString(2, data)
          setObject(3, collection)
        }
        .executeQuery()
        .use { results ->
          results.next()
          UpdateCollectionResponse.newBuilder()
              .apply {
                collectionBuilder
                    .setId(request.id)
                    .setName(results.getString(1))
                    .setData(results.getString(2))
                    .setVersion(access.version)
                    .setRole(access.role)
              }
              .build()
        }
  }
}

private fun deleteCollection(
    ctx: Context, request: DeleteCollectionRequest): DeleteCollectionResponse {
  val user = requireUser(ctx)
  val collection = parseUuid(request.id)
  transact { connection ->
    val access = lockEditableCollection(connection, collection, user)
    if (access.role != Role.ROLE_OWNER) {
      throw ForbiddenResponse()
    }

    // The foreign keys to collections don't cascade, so everything pointing at it goes first. A
    // save waiting on the lock finds no collection once we commit and gets a 404.
    for (sql in listOf(
        "DELETE FROM collection_grants WHERE collection_id = ?",
        "DELETE FROM collection_invites WHERE collection_id = ?",
        "DELETE FROM view_states WHERE collection_id = ?",
        "DELETE FROM folders WHERE collection = ?",
        "DELETE FROM lines WHERE collection = ?",
        "DELETE FROM points WHERE collection = ?",
        "DELETE FROM polygons WHERE collection = ?",
        "DELETE FROM collections WHERE id = ?")) {
      connection
          .prepareStatement(sql)
          .apply {
            setObject(1, collection)
          }
          .executeUpdate()
    }
  }
  return DeleteCollectionResponse.getDefaultInstance()
}

private fun getOsmTags(request: GetOsmTagsRequest): GetOsmTagsResponse {
  // Keep in sync with SourceTags.kt#SourceType.
  val type = when (request.type) {
    OsmElementType.OSM_ELEMENT_TYPE_NODE -> 0
    OsmElementType.OSM_ELEMENT_TYPE_WAY -> 1
    OsmElementType.OSM_ELEMENT_TYPE_RELATION -> 2
    else -> throw BadRequestResponse("Unknown source type ${request.type}")
  }

  hikariTrailcatalog.connection.use { connection ->
    connection
        .prepareStatement(
            "SELECT version, tags::text FROM source_tags "
                + "WHERE source_type = ? AND source_id = ? AND epoch = ?")
        .apply {
          setShort(1, type.toShort())
          setLong(2, request.id)
          setInt(3, epochTracker.epoch)
        }
        .executeQuery()
        .use { results ->
          if (!results.next()) {
            throw NotFoundResponse()
          }

          val response = GetOsmTagsResponse.newBuilder()
          val version = results.getInt(1)
          if (!results.wasNull()) {
            response.setVersion(version)
          }
          for ((key, value) in ObjectMapper().readTree(results.getString(2)).fields()) {
            response.putTags(key, value.asText())
          }
          return response.build()
        }
  }
}

private fun getSharing(ctx: Context, request: GetSharingRequest): GetSharingResponse {
  val user = requireUser(ctx)
  val collection = parseUuid(request.collectionId)
  hikari.connection.use { connection ->
    requireOwner(connection, collection, user)
    return GetSharingResponse.newBuilder().setSharing(readSharing(connection, collection)).build()
  }
}

private fun getTimeZone(request: GetTimeZoneRequest): GetTimeZoneResponse {
  val point = S2LatLng.fromDegrees(request.latDegrees, request.lngDegrees).toPoint()
  // polygonToCell files a polygon under a cell whose neighbors, together with it, cover the
  // polygon, so a polygon holding the point is under one of the cells next to its ancestors.
  val cells = (0 until 6).map { S2CellId.fromFace(it) }.toMutableList()
  val leaf = S2CellId.fromPoint(point)
  for (level in 1..SimpleS2.HIGHEST_INDEX_LEVEL) {
    val ancestor = leaf.parent(level)
    cells.add(ancestor)
    ancestor.getAllNeighbors(level, cells)
  }

  hikari.connection.use { connection ->
    connection
        .prepareStatement(
            "SELECT data->>'zone', s2_polygon FROM polygons "
                + "WHERE collection = ? AND deleted IS NULL AND cell = ANY(?)")
        .apply {
          setObject(1, TIME_ZONES_COLLECTION_ID)
          setArray(2, connection.createArrayOf("bigint", cells.map { it.id() }.toTypedArray()))
        }
        .executeQuery()
        .use { results ->
          while (results.next()) {
            if (S2Polygon.decode(ByteArrayInputStream(results.getBytes(2))).contains(point)) {
              return GetTimeZoneResponse.newBuilder().setZone(results.getString(1)).build()
            }
          }
        }
  }
  throw NotFoundResponse()
}

private fun setAnyoneCanView(
    ctx: Context, request: SetAnyoneCanViewRequest): SetAnyoneCanViewResponse {
  val user = requireUser(ctx)
  val collection = parseUuid(request.collectionId)
  val sql =
      if (request.anyoneCanView) {
        ("INSERT INTO collection_grants (collection_id, grantee_id, role) VALUES (?, ?, 'read') "
            + "ON CONFLICT (collection_id, grantee_id) DO NOTHING")
      } else {
        "DELETE FROM collection_grants WHERE collection_id = ? AND grantee_id = ?"
      }
  return transact { connection ->
    lockOwnedCollection(connection, collection, user)
    connection
        .prepareStatement(sql)
        .apply {
          setObject(1, collection)
          setObject(2, ANONYMOUS_USER_ID)
        }
        .executeUpdate()
    SetAnyoneCanViewResponse.newBuilder().setSharing(readSharing(connection, collection)).build()
  }
}

private fun setGrant(ctx: Context, request: SetGrantRequest): SetGrantResponse {
  val user = requireUser(ctx)
  val collection = parseUuid(request.collectionId)
  val grantee = parseUuid(request.userId)
  if (grantee == ANONYMOUS_USER_ID) {
    throw BadRequestResponse("Use SetAnyoneCanView")
  }
  val role = if (request.role == Role.ROLE_UNSPECIFIED) null else formatRole(request.role)

  return transact { connection ->
    lockOwnedCollection(connection, collection, user)
    val changed =
        if (role == null) {
          connection
              .prepareStatement(
                  "DELETE FROM collection_grants WHERE collection_id = ? AND grantee_id = ?")
              .apply {
                setObject(1, collection)
                setObject(2, grantee)
              }
              .executeUpdate()
        } else {
          connection
              .prepareStatement(
                  "UPDATE collection_grants SET role = ? "
                      + "WHERE collection_id = ? AND grantee_id = ?")
              .apply {
                setString(1, role)
                setObject(2, collection)
                setObject(3, grantee)
              }
              .executeUpdate()
        }
    if (changed == 0) {
      throw NotFoundResponse()
    }
    SetGrantResponse.newBuilder().setSharing(readSharing(connection, collection)).build()
  }
}

private fun setViewState(ctx: Context, request: SetViewStateRequest): SetViewStateResponse {
  val user = requireUser(ctx)
  val collection = parseUuid(request.collectionId)
  val hidden = request.hiddenFeatureIdsList.map { parseUuid(it) }.distinct()
  hikari.connection.use { connection ->
    val access = getCollectionAccess(connection, collection, user) ?: throw NotFoundResponse()
    if (!canEdit(access.role)) {
      throw ForbiddenResponse()
    }

    connection
        .prepareStatement(
            "INSERT INTO view_states (collection_id, user_id, hidden_feature_ids, layers) "
                + "VALUES (?, ?, ?, ?::jsonb) "
                + "ON CONFLICT (collection_id, user_id) DO UPDATE SET "
                + "hidden_feature_ids = EXCLUDED.hidden_feature_ids, "
                + "layers = EXCLUDED.layers")
        .apply {
          setObject(1, collection)
          setObject(2, user)
          setArray(3, connection.createArrayOf("UUID", hidden.toTypedArray()))
          setString(4, request.layers.ifEmpty { null })
        }
        .executeUpdate()
  }
  return SetViewStateResponse.getDefaultInstance()
}

private fun readSharing(connection: Connection, collection: UUID): Sharing {
  val sharing = Sharing.newBuilder()
  connection
      .prepareStatement(
          "SELECT g.grantee_id, u.display_name, g.role, u.email "
              + "FROM collection_grants g "
              + "JOIN users u ON u.id = g.grantee_id "
              + "WHERE g.collection_id = ? "
              + "ORDER BY LOWER(u.display_name)")
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
                .setUserId((results.getObject(1) as UUID).toString())
                .setDisplayName(results.getString(2))
                .setRole(parseRole(results.getString(3)))
                .setEmail(results.getString(4) ?: "")
          }
        }
      }
  return sharing.addAllInvites(listUnexpiredInvites(connection, collection)).build()
}

private fun createInvite(ctx: Context, request: CreateInviteRequest): CreateInviteResponse {
  val user = requireUser(ctx)
  val collection = parseUuid(request.collectionId)
  val role = formatRole(request.role)
  if (request.hasExpiresAfterSeconds() && request.expiresAfterSeconds <= 0) {
    throw BadRequestResponse("expires_after_seconds must be positive")
  }

  val code = (0 until INVITE_CODE_CHARS)
      .map { INVITE_CODE_ALPHABET[random.nextInt(INVITE_CODE_ALPHABET.length)] }
      .joinToString("")
  return transact { connection ->
    lockOwnedCollection(connection, collection, user)
    connection
        .prepareStatement(
            "INSERT INTO collection_invites "
                + "(code, collection_id, role, created_by, expires) "
                + "VALUES (?, ?, ?, ?, NOW() + ? * INTERVAL '1 second') "
                + "RETURNING $INVITE_COLUMNS")
        .apply {
          setString(1, code)
          setObject(2, collection)
          setString(3, role)
          setObject(4, user)
          if (request.hasExpiresAfterSeconds()) {
            setLong(5, request.expiresAfterSeconds)
          } else {
            setNull(5, Types.BIGINT)
          }
        }
        .executeQuery()
        .use { results ->
          results.next()
          CreateInviteResponse.newBuilder()
              .setInvite(parseInvite(results))
              .setSharing(readSharing(connection, collection))
              .build()
        }
  }
}

private fun getInvite(ctx: Context, request: GetInviteRequest): GetInviteResponse {
  val user = optionalUser(ctx)
  hikari.connection.use { connection ->
    val invite = getUnexpiredInvite(connection, request.code, user)
    return GetInviteResponse.newBuilder()
        .setCollectionId(invite.collection.toString())
        .setCollectionName(invite.collectionName)
        .setInviterName(invite.inviterName)
        .setRole(invite.role)
        .setCurrentRole(invite.userRole)
        .build()
  }
}

private fun acceptInvite(ctx: Context, request: AcceptInviteRequest): AcceptInviteResponse {
  val user = requireUser(ctx)
  return transact { connection ->
    val invite = getUnexpiredInvite(connection, request.code, user)
    if (invite.userRole.number < invite.role.number) {
      connection
          .prepareStatement(
              "INSERT INTO collection_grants (collection_id, grantee_id, role) VALUES (?, ?, ?) "
                  + "ON CONFLICT (collection_id, grantee_id) DO UPDATE SET role = EXCLUDED.role")
          .apply {
            setObject(1, invite.collection)
            setObject(2, user)
            setString(3, formatRole(invite.role))
          }
          .executeUpdate()
      connection
          .prepareStatement("UPDATE collection_invites SET uses = uses + 1 WHERE code = ?")
          .apply {
            setString(1, request.code)
          }
          .executeUpdate()
    }
    AcceptInviteResponse.newBuilder().setCollectionId(invite.collection.toString()).build()
  }
}

private fun revokeInvite(ctx: Context, request: RevokeInviteRequest): RevokeInviteResponse {
  val user = requireUser(ctx)
  return transact { connection ->
    val collection =
        connection
            .prepareStatement(
                "SELECT collection_id FROM collection_invites WHERE code = ? FOR UPDATE")
            .apply {
              setString(1, request.code)
            }
            .executeQuery()
            .use { results ->
              if (!results.next()) {
                throw NotFoundResponse()
              }
              results.getObject(1) as UUID
            }
    requireOwner(connection, collection, user)
    connection
        .prepareStatement("DELETE FROM collection_invites WHERE code = ?")
        .apply {
          setString(1, request.code)
        }
        .executeUpdate()
    RevokeInviteResponse.newBuilder().setSharing(readSharing(connection, collection)).build()
  }
}

private data class UnexpiredInvite(
    val collection: UUID,
    val collectionName: String,
    val inviterName: String,
    val role: Role,
    // What the user has through ownership or their own grant. Sharing with anyone doesn't count, so
    // that accepting a read invite to a collection anyone can view still adds it to their list.
    val userRole: Role,
)

// Throws a 404 for a code that was revoked or expired, so they look the same.
private fun getUnexpiredInvite(
    connection: Connection, code: String, user: UUID?): UnexpiredInvite {
  connection
      .prepareStatement(
          "SELECT i.collection_id, c.name, c.creator, u.display_name, i.role, g.role "
              + "FROM collection_invites i "
              + "JOIN collections c ON c.id = i.collection_id "
              + "JOIN users u ON u.id = i.created_by "
              + "LEFT JOIN collection_grants g "
              + "ON g.collection_id = i.collection_id AND g.grantee_id = ? "
              + "WHERE i.code = ? "
              + "AND (i.expires IS NULL OR i.expires > NOW()) "
              + "FOR SHARE OF c")
      .apply {
        setObject(1, user)
        setString(2, code)
      }
      .executeQuery()
      .use { results ->
        if (!results.next()) {
          throw NotFoundResponse()
        }
        val grant = results.getString(6)
        return UnexpiredInvite(
            collection = results.getObject(1) as UUID,
            collectionName = results.getString(2),
            inviterName = results.getString(4),
            role = parseRole(results.getString(5)),
            userRole =
                when {
                  user != null && results.getObject(3) == user -> Role.ROLE_OWNER
                  grant != null -> parseRole(grant)
                  else -> Role.ROLE_UNSPECIFIED
                },
        )
      }
}

private fun listUnexpiredInvites(connection: Connection, collection: UUID): List<Invite> {
  val invites = ArrayList<Invite>()
  connection
      .prepareStatement(
          "SELECT $INVITE_COLUMNS "
              + "FROM collection_invites "
              + "WHERE collection_id = ? "
              + "AND (expires IS NULL OR expires > NOW()) "
              + "ORDER BY created DESC")
      .apply {
        setObject(1, collection)
      }
      .executeQuery()
      .use { results ->
        while (results.next()) {
          invites.add(parseInvite(results))
        }
      }
  return invites
}

private fun parseInvite(results: ResultSet): Invite {
  val invite =
      Invite.newBuilder()
          .setCode(results.getString(1))
          .setRole(parseRole(results.getString(2)))
          .setUses(results.getInt(3))
  results.getTimestamp(4)?.let { invite.setExpiresEpochMs(it.time) }
  return invite.build()
}

private fun save(ctx: Context, request: SaveRequest): SaveResponse {
  val user = requireUser(ctx)
  val collection = parseUuid(request.collectionId)
  // Validated and encoded up front so that a bad write fails before we take the collection lock.
  val writes = request.writesList.map { prepareWrite(it) }
  val seen = HashSet<WriteKey>()
  for (write in writes) {
    // The version check reads what the batch already wrote, so a second write to the same feature
    // would always look stale.
    if (!seen.add(write.key)) {
      throw BadRequestResponse("${write.key} is written twice")
    }
  }

  return transact { connection ->
    val version = lockEditableCollection(connection, collection, user).version + 1
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
  POLYGONS("polygons"),
}

// What a write writes, which a batch may write only once
private sealed interface WriteKey

private data class FeatureKey(val table: Table, val id: UUID) : WriteKey {
  override fun toString() = "${table.sql} $id"
}

private data object SchemaKey : WriteKey {
  override fun toString() = "The schema"
}

private abstract class PreparedWrite(val key: WriteKey) {
  abstract fun apply(connection: Connection, collection: UUID, version: Long)
}

private fun prepareWrite(write: Write): PreparedWrite {
  return when (write.writeCase) {
    Write.WriteCase.PUT_FOLDER -> prepareFolder(write.putFolder)
    Write.WriteCase.PUT_LINE -> prepareLine(write.putLine)
    Write.WriteCase.PUT_POINT -> preparePoint(write.putPoint)
    Write.WriteCase.PUT_POLYGON -> preparePolygon(write.putPolygon)
    Write.WriteCase.DELETE -> prepareDelete(write.delete)
    Write.WriteCase.PUT_SCHEMA -> prepareSchema(write.putSchema)
    else -> throw BadRequestResponse("A write needs a feature")
  }
}

private fun prepareFolder(folder: Folder): PreparedWrite {
  val id = parseUuid(folder.id)
  val data = jsonOrEmptyObject(folder.data)

  return object : PreparedWrite(FeatureKey(Table.FOLDERS, id)) {
    override fun apply(connection: Connection, collection: UUID, version: Long) {
      checkPutVersion(connection, Table.FOLDERS, collection, id, folder.version)
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
  val data = jsonOrEmptyObject(line.data)

  return object : PreparedWrite(FeatureKey(Table.LINES, id)) {
    override fun apply(connection: Connection, collection: UUID, version: Long) {
      checkPutVersion(connection, Table.LINES, collection, id, line.version)
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
  val data = jsonOrEmptyObject(point.data)

  return object : PreparedWrite(FeatureKey(Table.POINTS, id)) {
    override fun apply(connection: Connection, collection: UUID, version: Long) {
      checkPutVersion(connection, Table.POINTS, collection, id, point.version)
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

private fun preparePolygon(polygon: Polygon): PreparedWrite {
  val id = parseUuid(polygon.id)
  if (polygon.latLngE7Count % 2 != 0) {
    throw BadRequestResponse("Points are interleaved lat then lng")
  }

  val pointCount = polygon.latLngE7Count / 2
  if (pointCount < 3) {
    throw BadRequestResponse("A polygon needs three points")
  }

  val latLngE7 = IntArray(polygon.latLngE7Count) { polygon.getLatLngE7(it) }
  val ring =
      List(pointCount + 1) {
        val i = it % pointCount
        S2LatLng.fromE7(latLngE7[2 * i], latLngE7[2 * i + 1]).toPoint()
      }
  // The ring's vertices bound everything it encloses, so the cell holding them holds the polygon.
  // polygonToCell has no cell to give a ring whose area snaps away to nothing.
  val cell = polylineToCell(S2Polyline(ring))
  val s2Polygon =
      ByteArrayOutputStream().use {
        assemblePolygon(listOf(listOf(ring))).encode(it)
        it.toByteArray()
      }
  val geometry = DeltaLatLngE7.encode(latLngE7)
  val data = jsonOrEmptyObject(polygon.data)

  return object : PreparedWrite(FeatureKey(Table.POLYGONS, id)) {
    override fun apply(connection: Connection, collection: UUID, version: Long) {
      checkPutVersion(connection, Table.POLYGONS, collection, id, polygon.version)
      connection
          .prepareStatement(
              "INSERT INTO polygons "
                  + "(id, collection, cell, created, updated, data, s2_polygon, lat_lng_degrees, "
                  + "version) "
                  + "VALUES (?, ?, ?, NOW(), NOW(), ?::jsonb, ?, ?, ?) "
                  + "ON CONFLICT (collection, id) DO UPDATE SET "
                  + "cell = EXCLUDED.cell, data = EXCLUDED.data, "
                  + "s2_polygon = EXCLUDED.s2_polygon, "
                  + "lat_lng_degrees = EXCLUDED.lat_lng_degrees, "
                  + "version = EXCLUDED.version, updated = NOW(), deleted = NULL")
          .apply {
            setObject(1, id)
            setObject(2, collection)
            setLong(3, cell.id())
            setString(4, data)
            setBytes(5, s2Polygon)
            setBytes(6, geometry)
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
        FeatureKind.FEATURE_KIND_POLYGON -> Table.POLYGONS
        else -> throw BadRequestResponse("A delete needs a kind")
      }

  return object : PreparedWrite(FeatureKey(table, id)) {
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

private fun prepareSchema(put: PutSchema): PreparedWrite {
  val schema = jsonOrEmptyObject(put.schema)

  return object : PreparedWrite(SchemaKey) {
    override fun apply(connection: Connection, collection: UUID, version: Long) {
      val existing =
          connection
              .prepareStatement("SELECT schema_version FROM collections WHERE id = ?")
              .apply {
                setObject(1, collection)
              }
              .executeQuery()
              .use { results ->
                results.next()
                results.getLong(1)
              }
      if (existing != put.version) {
        throw ConflictResponse("The schema changed since it was read")
      }

      connection
          .prepareStatement(
              "UPDATE collections SET schema = ?::jsonb, schema_version = ? WHERE id = ?")
          .apply {
            setString(1, schema)
            setLong(2, version)
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
private fun checkPutVersion(
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
private fun jsonOrEmptyObject(data: String): String {
  return data.ifEmpty { "{}" }
}

// Holds the collection row until the transaction ends so we can go back and update covering after a
// geometry change, and so that concurrent saves to one collection apply one after the other.
private fun lockEditableCollection(connection: Connection, collection: UUID, user: UUID): Access {
  lockCollectionRow(connection, collection)
  val access = getCollectionAccess(connection, collection, user) ?: throw NotFoundResponse()
  if (!canEdit(access.role)) {
    throw ForbiddenResponse()
  }
  return access
}

private fun lockOwnedCollection(connection: Connection, collection: UUID, user: UUID) {
  lockCollectionRow(connection, collection)
  requireOwner(connection, collection, user)
}

private fun lockCollectionRow(connection: Connection, collection: UUID) {
  connection
      .prepareStatement("SELECT 1 FROM collections WHERE id = ? FOR UPDATE")
      .apply {
        setObject(1, collection)
      }
      .executeQuery()
      .close()
}

// Selects id, data, version, and then any geometry columns from the collection's undeleted rows.
// readGeometry only runs when there are geometry columns.
private fun <T> forEachFeature(
    connection: Connection,
    collection: UUID,
    table: Table,
    geometryColumns: String?,
    where: String? = null,
    add: (ResultSet) -> T,
    readGeometry: (T, ResultSet) -> Unit = { _, _ -> }) {
  connection
      .prepareStatement(
          "SELECT id, data, version"
              + (if (geometryColumns == null) "" else ", $geometryColumns")
              + " FROM ${table.sql}"
              + " WHERE collection = ? AND deleted IS NULL"
              + (if (where == null) "" else " AND $where"))
      .apply {
        setObject(1, collection)
      }
      .executeQuery()
      .use { results ->
        while (results.next()) {
          val feature = add(results)
          if (geometryColumns != null) {
            readGeometry(feature, results)
          }
        }
      }
}

private fun requireOwner(connection: Connection, collection: UUID, user: UUID) {
  val access = getCollectionAccess(connection, collection, user) ?: throw NotFoundResponse()
  if (access.role != Role.ROLE_OWNER) {
    throw ForbiddenResponse()
  }
}

private fun canEdit(role: Role): Boolean {
  return role == Role.ROLE_OWNER || role == Role.ROLE_WRITE
}

private data class Access(
    val name: String, val data: String, val version: Long, val creator: UUID, val role: Role)

// Answers null for a collection the user may not see, so that it looks the same as one that does
// not exist. A null user is signed out and sees what was shared with anyone.
//
// A collection the anonymous user created is public, which is how PublicAccess imports land.
private fun getCollectionAccess(connection: Connection, collection: UUID, user: UUID?): Access? {
  val grantees = if (user != null) arrayOf(ANONYMOUS_USER_ID, user) else arrayOf(ANONYMOUS_USER_ID)
  connection
      .prepareStatement(
          "SELECT c.name, c.data, c.version, c.creator, g.grantee_id, g.role "
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
          val data = results.getString(2)
          val version = results.getLong(3)
          val creator = results.getObject(4) as UUID
          val grantee = results.getObject(5) as UUID?
          val role =
              when {
                user != null && creator == user -> Role.ROLE_OWNER
                grantee == null -> if (creator == ANONYMOUS_USER_ID) Role.ROLE_READ else null
                // Only a grant naming the user can write. The table refuses a write grant to
                // anyone too, but a stray one would otherwise open the collection to everybody.
                grantee != user -> Role.ROLE_READ
                else -> parseRole(results.getString(6))
              }
          if (role != null && (access == null || role.number > access.role.number)) {
            access = Access(name, data, version, creator, role)
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

private fun formatRole(role: Role): String {
  return when (role) {
    Role.ROLE_READ -> "read"
    Role.ROLE_WRITE -> "write"
    else -> throw BadRequestResponse("$role is not read or write")
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
              + "SELECT cell FROM polygons WHERE collection = ? AND deleted IS NULL")
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

private data class WirePoint(val id: UUID, val data: String, val latLngDegrees: ByteArray)

private data class WirePolygon(val id: UUID, val data: String, val s2Polygon: ByteArray)

private fun fetchCollectionCovering(ctx: Context) {
  // Revalidate this one response, because it is what tells a client the collection version.
  // Everything it points at is immutable, see setCacheHeadersAndCheckNotModified.
  ctx.header("Cache-Control", "no-cache,private")

  val collection = ctx.pathParam("id")
  val bytes = AlignableByteArrayOutputStream()
  DelegatingEncodedOutputStream(bytes).use {
    // version
    it.writeVarInt(3)

    // collection version, then covering, then schema
    if (isTrailcatalogCollection(collection)) {
      // The epoch is the version: the paths and points a tile holds only change when an import
      // lands.
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
      // no schema because the client has its own style for these
      it.writeVarInt(0)
    } else {
      hikari.connection.use { connection ->
        val id = parseUuid(collection)
        if (getCollectionAccess(connection, id, optionalUser(ctx)) == null) {
          ctx.status(HttpStatus.NOT_FOUND)
          return@fetchCollectionCovering
        }

        connection
          .prepareStatement("SELECT covering, version, schema FROM collections WHERE id = ?")
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
            val schema = (results.getString(3) ?: "").toByteArray(StandardCharsets.UTF_8)
            it.writeVarInt(schema.size)
            it.write(schema)
          }
      }
    }
  }
  ctx.result(bytes.toByteArray())
}

private fun fetchCollectionObjects(ctx: Context) {
  val collection = ctx.pathParam("id")
  val trailcatalog = isTrailcatalogCollection(collection)
  // The object queries trust that this checked access, because they filter on nothing else.
  val currentVersion =
      if (trailcatalog) {
        epochTracker.epoch.toLong()
      } else {
        hikari.connection.use { connection ->
          getCollectionAccess(connection, parseUuid(collection), optionalUser(ctx))?.version
        } ?: throw NotFoundResponse()
      }
  // Checked before the object queries run, or else a revalidation costs everything a miss does.
  val requestedVersion = ctx.queryParam("version")?.toLong()
  if (setCacheHeadersAndCheckNotModified(ctx, requestedVersion, currentVersion, trailcatalog)) {
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
    it.writeVarInt(3)

    if (collection == TRAILCATALOG_PATHS_COLLECTIONS_ID) {
      it.writeVarInt(KIND_PACKED_PATH)
      fetchTrailcatalogPaths(it, cell, indexBottom, levelCeiling, levelFloor, snap)
    } else if (collection == TRAILCATALOG_POINTS_COLLECTIONS_ID) {
      it.writeVarInt(KIND_PACKED_POINT)
      fetchTrailcatalogPoints(it, cell, indexBottom, levelCeiling, levelFloor)
    } else {
      it.writeVarInt(KIND_UUID_JSON)
      fetchTrailsLatObjects(it, cell, collection, indexBottom, levelCeiling, levelFloor, snap)
    }
  }

  ctx.result(bytes.toByteArray())
}

// Unsimplified geometry for a handful of lines named by id, for the drawing tools to swap in for
// the simplified copies they routed along. Paths are named by a UUID whose lsb is the path id,
// which is the RawUuid the objects endpoint gives them.
private fun fetchCollectionLines(ctx: Context) {
  val collection = ctx.pathParam("id")
  val ids = (ctx.queryParam("ids") ?: "").split(",").filter { it.isNotEmpty() }.map(::parseUuid)
  if (ids.size > MAX_LINES_BY_ID) {
    throw BadRequestResponse("Too many ids")
  }

  val bytes = AlignableByteArrayOutputStream()
  DelegatingEncodedOutputStream(bytes).use {
    if (collection == TRAILCATALOG_PATHS_COLLECTIONS_ID) {
      fetchTrailcatalogPathsById(it, ids)
    } else {
      hikari.connection.use { connection ->
        // The query below trusts this, because it filters on nothing else.
        getCollectionAccess(connection, parseUuid(collection), optionalUser(ctx))
            ?: throw NotFoundResponse()
        connection
          .prepareStatement(
            "SELECT id, lat_lng_degrees "
                    + "FROM lines "
                    + "WHERE collection = ? AND deleted IS NULL AND id = ANY (?)"
          )
          .apply {
            setObject(1, UUID.fromString(collection))
            setArray(2, connection.createArrayOf("UUID", ids.toTypedArray()))
          }
          .executeQuery()
          .use { results ->
            writeLinesById(it, results) { results.getObject(1) as UUID }
          }
      }
    }
  }
  ctx.header("Cache-Control", "no-cache,private")
  ctx.result(bytes.toByteArray())
}

private fun fetchTrailcatalogPathsById(it: DelegatingEncodedOutputStream, ids: List<UUID>) {
  hikariTrailcatalog.connection.use { connection ->
    connection
      .prepareStatement("SELECT id, lat_lng_degrees FROM paths WHERE epoch = ? AND id = ANY (?)")
      .apply {
        setInt(1, epochTracker.epoch)
        setArray(
          2, connection.createArrayOf("BIGINT", ids.map { it.leastSignificantBits }.toTypedArray()))
      }
      .executeQuery()
      .use { results ->
        writeLinesById(it, results) { UUID(0, results.getLong(1)) }
      }
  }
}

// count, then id_lsb,id_msb,lat_lng_degrees for each. Keep in sync with
// line_refiner.ts#decodeLines.
private fun writeLinesById(
    it: DelegatingEncodedOutputStream, results: ResultSet, id: () -> UUID) {
  val lines = ArrayList<Pair<UUID, ByteArray>>()
  while (results.next()) {
    lines.add(Pair(id(), results.getBytes(2)))
  }
  it.writeVarInt(lines.size)
  for ((uuid, latLngDegrees) in lines) {
    it.writeLong(uuid.leastSignificantBits)
    it.writeLong(uuid.mostSignificantBits)
    it.write(latLngDegrees)
  }
}

private fun fetchTrailsLatObjects(
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
                + "p.deleted IS NULL AND "
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

    // points
    connection
      .prepareStatement(
        "SELECT p.id, p.data, p.lat_lng_degrees "
                + "FROM points p "
                + "WHERE "
                + "p.collection = ? AND "
                + "p.deleted IS NULL AND "
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
        val points = ArrayList<WirePoint>()
        while (results.next()) {
          points.add(
            WirePoint(results.getObject(1) as UUID, results.getString(2), results.getBytes(3)))
        }
        it.writeVarInt(points.size)
        for (point in points) {
          it.writeLong(point.id.leastSignificantBits)
          it.writeLong(point.id.mostSignificantBits)
          point.data.toByteArray(StandardCharsets.UTF_8).let { utf8 ->
            it.writeVarInt(utf8.size)
            it.write(utf8)
          }
          // already encoded with DeltaLatLngE7
          it.write(point.latLngDegrees)
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

    // no polygons or points, because the paths table only has paths
    it.writeVarInt(0)
    it.writeVarInt(0)
  }
}

private fun fetchTrailcatalogPoints(
  it: DelegatingEncodedOutputStream,
  cell: S2CellId,
  indexBottom: Int,
  levelCeiling: Long?,
  levelFloor: Long?,
) {
  val epoch = epochTracker.epoch
  hikariTrailcatalog.connection.use { connection ->
    val single = cell.level() < indexBottom
    connection
      .prepareStatement(
        "SELECT p.id, p.type, p.name, p.marker_degrees_e7 "
                + "FROM points p "
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
        val points = ByteArrayOutputStream()
        var count = 0
        DelegatingEncodedOutputStream(points).use { out ->
          while (results.next()) {
            count += 1
            // id,type,name,marker
            out.writeVarLong(results.getLong(1))
            out.writeVarInt(results.getInt(2))
            val name = (results.getString(3) ?: "").toByteArray(Charsets.UTF_8)
            out.writeVarInt(name.size)
            out.write(name)
            // Stored as the little endian lat then lng E7 pair the client reads.
            out.write(results.getBytes(4))
          }
        }
        it.writeVarInt(count)
        it.write(points.toByteArray())
      }
  }
}

private fun isTrailcatalogCollection(collection: String): Boolean {
  return collection == TRAILCATALOG_PATHS_COLLECTIONS_ID
      || collection == TRAILCATALOG_POINTS_COLLECTIONS_ID
}

// Lets the browser and the CDN hold a tile until the collection version changes, because the object
// URL names that version and so can never go stale under its own key.
//
// Only the trailcatalog collections are public. Every other collection answers only if the
// requesting user may read it, and the owner can take that back, so it may only ever land in that
// browser's cache.
private fun setCacheHeadersAndCheckNotModified(
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
  val shared = findSharedVertices(decoded)
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
private fun findSharedVertices(lines: List<IntArray>): LongArray {
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
