package lat.trails

import com.fasterxml.jackson.databind.ObjectMapper
import com.google.common.geometry.S1Angle
import com.google.common.geometry.S2CellId
import com.google.common.geometry.S2Polygon
import com.google.common.geometry.S2Projections
import com.zaxxer.hikari.HikariDataSource
import io.javalin.Javalin
import io.javalin.http.Context
import io.javalin.http.Header
import io.javalin.http.HttpStatus
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.UUID
import kotlin.collections.ArrayList
import java.nio.charset.StandardCharsets
import lat.trails.common.createBaseConnection
import lat.trails.common.createTrailcatalogConnection
import org.trailcatalog.common.AlignableByteArrayOutputStream
import org.trailcatalog.common.DelegatingEncodedOutputStream
import org.trailcatalog.flags.parseFlags
import org.trailcatalog.EpochTracker
import java.time.LocalDate
import java.time.ZoneOffset
import kotlin.use

private lateinit var epochTracker: EpochTracker
private lateinit var hikari: HikariDataSource
private lateinit var hikariTrailcatalog: HikariDataSource

private val TRAILCATALOG_PATHS_COLLECTIONS_ID = "00000000-0000-0000-0000-000000000001"

fun main(args: Array<String>) {
  parseFlags(args)

  hikari = createBaseConnection()
  hikariTrailcatalog = createTrailcatalogConnection()
  epochTracker = EpochTracker(hikariTrailcatalog)
  val app = Javalin.create {}.start(7051)
  app.post("/api/data", ::fetchData)
  app.get("/api/collections/{id}/covering", ::fetchCollectionCovering)
  app.get("/api/collections/{id}/objects/{cell}", ::fetchCollectionObjects)
}

private data class WireCollection(val id: UUID, val name: String)

private fun fetchData(ctx: Context) {
  val mapper = ObjectMapper()
  val request = mapper.readTree(ctx.bodyInputStream())
  val keys = request.get("keys").elements()
  val responses = ArrayList<Any>()
  for (key in keys) {
    val type = key.get("method").asText()
    when (type) {
      null -> throw IllegalArgumentException("Key has no type")
      "collections" -> {
        val collections = ArrayList<WireCollection>()
        hikari.connection.use { connection ->
          connection.prepareStatement("SELECT id, name FROM collections WHERE creator = ?")
              .apply {
                setLong(1, 0)
              }
              .executeQuery()
              .use { results ->
                while (results.next()) {
                  collections.add(
                      WireCollection(
                          results.getObject(1) as UUID, results.getString(1)))
                }
              }
        }
        responses.add(
            mapOf("kind" to "result", "value" to hashMapOf("collections" to collections.map {
              val row = HashMap<String, Any>()
              row["id"] = it.id
              row["name"] = it.name
              row
            }))
        )
      }
    }
  }

  ctx.json(HashMap<String, Any>().also {
    it["values"] = responses
  })
}

private data class WireLine(val id: UUID, val data: String, val latLngDegrees: ByteArray)

private data class WirePolygon(val id: UUID, val data: String, val s2Polygon: ByteArray)

private fun fetchCollectionCovering(ctx: Context) {
  val allowed = arrayListOf(UUID.fromString("00000000-0000-0000-0000-000000000000"))
  ctx.header("X-User-ID").let {
    if (!it.isNullOrEmpty()) {
      allowed.add(UUID.fromString(it))
    }
  }

  val collection = ctx.pathParam("id")
  val bytes = AlignableByteArrayOutputStream()
  DelegatingEncodedOutputStream(bytes).use {
    // version
    it.writeVarInt(1)

    // covering
    if (collection == TRAILCATALOG_PATHS_COLLECTIONS_ID) {
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
            "SELECT c.covering "
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
  val allowed = arrayListOf(UUID.fromString("00000000-0000-0000-0000-000000000000"))
  ctx.header("X-User-ID").let {
    if (!it.isNullOrEmpty()) {
      allowed.add(UUID.fromString(it))
    }
  }

  val collection = ctx.pathParam("id")
  val cell = S2CellId.fromToken(ctx.pathParam("cell"))
  val bytes = AlignableByteArrayOutputStream()
  val indexBottom = ctx.queryParam("bottom")!!.toInt()
  val snap = ctx.queryParam("snap")?.toInt()
  // Streams split the objects by the level of the cell they were assigned to, so that no two tiles
  // carry the same object. The lowest set bit of a cell id is 4^(30 - level), so a level range is a
  // range on that bit, backwards: a coarser cell has a higher bit.
  val levelFloor = ctx.queryParam("maxLevel")?.toInt()?.let { 1L shl (2 * (30 - it)) }
  val levelCeiling = ctx.queryParam("minLevel")?.toInt()?.let { 1L shl (2 * (30 - it)) }
  val mostRecent = DelegatingEncodedOutputStream(bytes).use {
    // version
    it.writeVarInt(1)

    if (collection == TRAILCATALOG_PATHS_COLLECTIONS_ID) {
      fetchTrailcatalogPaths(it, bytes, cell, indexBottom, levelCeiling, levelFloor)
    } else {
      fetchRealCollection(it, bytes, allowed, cell, collection, indexBottom, levelCeiling, levelFloor, snap)
    }
  }

  if (!contentIsCached(ctx, mostRecent)) {
    ctx.result(bytes.toByteArray())
  }
}

private fun fetchRealCollection(
  it: DelegatingEncodedOutputStream,
  align: AlignableByteArrayOutputStream,
  allowed: ArrayList<UUID>,
  cell: S2CellId,
  collection: String,
  indexBottom: Int,
  levelCeiling: Long?,
  levelFloor: Long?,
  snap: Int?,
): Instant {
  var mostRecent = Instant.EPOCH
  hikari.connection.use { connection ->
    val single = cell.level() < indexBottom

    // lines
    connection
      .prepareStatement(
        "SELECT l.id, l.data, l.lat_lng_degrees, l.created "
                + "FROM collections c "
                + "JOIN lines l ON c.id = l.collection "
                + "WHERE "
                + "c.id = ? AND "
                + "c.creator = ANY (?) AND "
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
              results.getBytes(3)
            )
          )
          mostRecent = mostRecent.coerceAtLeast(results.getTimestamp(4).toInstant())
        }
        it.writeVarInt(lines.size)
        for (line in lines) {
          it.writeLong(line.id.leastSignificantBits)
          it.writeLong(line.id.mostSignificantBits)
          line.data.toByteArray(StandardCharsets.UTF_8).let { utf8 ->
            it.writeVarInt(utf8.size)
            it.write(utf8)
          }
          it.writeVarInt(line.latLngDegrees.size / 2 / 4)
          align.align(4)
          it.write(line.latLngDegrees)
        }
      }

    // polygons
    connection
      .prepareStatement(
        "SELECT p.id, p.data, p.s2_polygon, p.created "
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
          mostRecent = mostRecent.coerceAtLeast(results.getTimestamp(4).toInstant())
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
  return mostRecent
}

private fun fetchTrailcatalogPaths(
  it: DelegatingEncodedOutputStream,
  align: AlignableByteArrayOutputStream,
  cell: S2CellId,
  indexBottom: Int,
  levelCeiling: Long?,
  levelFloor: Long?,
): Instant {
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
              results.getBytes(3)
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
          it.writeVarInt(line.latLngDegrees.size / 2 / 4)
          align.align(4)
          it.write(line.latLngDegrees)
        }
      }

    // polygons
    it.writeVarInt(0)
  }

  val day = epoch % 100
  val month = (epoch / 100) % 100
  val year = epoch / 10000
  return LocalDate.of(year, month, day).atTime(0, 0).toInstant(ZoneOffset.UTC)
}

private fun contentIsCached(ctx: Context, version: Instant): Boolean {
  "\"${version.hashCode()}\"".let { etag ->
    ctx.header("Cache-Control", "no-cache,private")
    ctx.header("ETag", etag)
    val modSince = DateTimeFormatter.RFC_1123_DATE_TIME.format(version.atZone(ZoneId.of("GMT")))
    ctx.header("Last-Modified", modSince)
    val requestModSince = ctx.header(Header.IF_MODIFIED_SINCE)
    val requestETag = ctx.header(Header.IF_NONE_MATCH)
    // nginx weakens etags when gzipping, so we have to also check if the user sent us a weak etag.
    if (modSince == requestModSince || etag == requestETag || "W/${etag}" == requestETag) {
      ctx.status(HttpStatus.NOT_MODIFIED)
      return true
    }
  }
  return false
}

