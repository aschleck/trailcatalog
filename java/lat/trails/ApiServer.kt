package lat.trails

import com.fasterxml.jackson.databind.ObjectMapper
import com.google.common.geometry.S2CellId
import com.zaxxer.hikari.HikariDataSource
import io.javalin.Javalin
import io.javalin.http.Context
import io.javalin.http.HttpStatus
import java.util.UUID
import kotlin.collections.ArrayList
import lat.trails.common.createConnection
import java.nio.charset.StandardCharsets
import org.trailcatalog.common.AlignableByteArrayOutputStream
import org.trailcatalog.common.DelegatingEncodedOutputStream
import org.trailcatalog.flags.parseFlags

private lateinit var hikari: HikariDataSource

fun main(args: Array<String>) {
  parseFlags(args)

  hikari = createConnection()
  val app = Javalin.create {}.start(7070)
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
    val type = key.get("type").asText()
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
            hashMapOf("collections" to collections.map {
              val row = HashMap<String, Any>()
              row["id"] = it.id
              row["name"] = it.name
              row
            })
        )
      }
    }
  }

  ctx.json(HashMap<String, Any>().also {
    it["values"] = responses
  })
}

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
  DelegatingEncodedOutputStream(bytes).use {
    // version
    it.writeVarInt(1)

    // polygons
    hikari.connection.use { connection ->
      // TODO(april): make this a constant!
      // TRAILS_LAT_S2_INDEX_LEVEL
      val single = cell.level() < 6
      connection
          .prepareStatement(
              "SELECT p.id, p.data, p.s2_polygon "
                      + "FROM collections c "
                      + "JOIN polygons p ON c.id = p.collection "
                      + "WHERE "
                      + "c.id = ? AND "
                      + "c.creator = ANY (?) AND "
                      + (if (single) "p.cell = ?" else "(p.cell >= ? AND p.cell <= ?) ")
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
          }
          .executeQuery()
          .use { results ->
            val polygons = ArrayList<WirePolygon>()
            while (results.next()) {
              polygons.add(
                  WirePolygon(
                      results.getObject(1) as UUID,
                      results.getString(2),
                      results.getBytes(3)))
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
  ctx.result(bytes.toByteArray())
}
