package lat.trails.importers

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.google.common.geometry.S2CellId
import com.google.common.geometry.S2LatLng
import com.google.common.geometry.S2Polygon
import com.google.common.geometry.S2Polyline
import java.io.ByteArrayOutputStream
import java.sql.Connection
import java.util.Base64
import java.util.TreeMap
import java.util.UUID
import lat.trails.common.assemblePolygon
import lat.trails.common.createBaseConnection
import lat.trails.common.encodeCovering
import org.apache.commons.text.StringEscapeUtils
import org.postgresql.copy.CopyManager
import org.postgresql.jdbc.PgConnection
import org.slf4j.LoggerFactory
import org.trailcatalog.common.DeltaLatLngE7
import org.trailcatalog.importers.basemap.StringifyingInputStream
import org.trailcatalog.importers.basemap.appendByteArray
import org.trailcatalog.s2.SimpleS2
import org.trailcatalog.s2.polygonToCell
import org.trailcatalog.s2.polylineToCell

// Shared by the importers that rewrite a collection with a fixed id on every run

private val logger = LoggerFactory.getLogger("ReplacedCollections")

private val mapper = ObjectMapper()

data class Row<G>(val id: UUID, val data: Map<String, String>, val cell: S2CellId, val geometry: G)

class ReplacedCollection(
    val id: UUID,
    val name: String,
    // the JSON for collections.schema, see schema.ts#CollectionSchema
    val schema: Map<String, Any>,
    // encoded with DeltaLatLngE7
    val lines: List<Row<ByteArray>> = listOf(),
    // encoded with DeltaLatLngE7
    val points: List<Row<ByteArray>> = listOf(),
    val polygons: List<Row<S2Polygon>> = listOf(),
)

fun lineRow(collection: UUID, key: String, data: Map<String, String>, latLngs: List<S2LatLng>):
    Row<ByteArray> =
    Row(
        stableId(collection, key),
        data,
        polylineToCell(S2Polyline(latLngs.map { it.toPoint() })),
        DeltaLatLngE7.encode(latLngs.flatMap { listOf(it.lat().e7(), it.lng().e7()) }.toIntArray()))

fun polygonRow(
    collection: UUID, key: String?, data: Map<String, String>, geometry: JsonNode):
    Row<S2Polygon>? {
  val polygon = toS2Polygon(geometry)
  if (polygon.numLoops() == 0) {
    logger.warn("Dropping {} from {} because its geometry is empty", data, collection)
    return null
  }
  val id = if (key != null) stableId(collection, key) else UUID.randomUUID()
  return Row(id, data, polygonToCell(polygon), polygon)
}

fun pointRow(collection: UUID, key: String, data: Map<String, String>, latLng: S2LatLng):
    Row<ByteArray> =
    Row(
        stableId(collection, key),
        data,
        S2CellId.fromLatLng(latLng).parent(SimpleS2.HIGHEST_INDEX_LEVEL),
        DeltaLatLngE7.encode(intArrayOf(latLng.lat().e7(), latLng.lng().e7())))

// Gives an object the same id on every run, so a client that has it selected keeps it selected
// after an import.
private fun stableId(collection: UUID, key: String): UUID =
    UUID.nameUUIDFromBytes("${collection}/${key}".toByteArray())

fun JsonNode.text(key: String): String? =
    get(key)?.takeUnless { it.isNull }?.asText()?.trim()?.takeIf { it.isNotEmpty() }

fun JsonNode.number(key: String): Double? = get(key)?.takeIf { it.isNumber }?.asDouble()

private fun toS2Polygon(geometry: JsonNode): S2Polygon {
  val polygons =
      when (val type = geometry["type"].asText()) {
        "Polygon" -> listOf(geometry["coordinates"])
        "MultiPolygon" -> geometry["coordinates"].toList()
        else -> throw IllegalArgumentException("Unexpected geometry type ${type}")
      }
  return assemblePolygon(polygons.map { polygon ->
    polygon.map { ring ->
      ring.map { S2LatLng.fromDegrees(it[1].asDouble(), it[0].asDouble()).toPoint() }
    }
  })
}

// Replaces the collection's objects in one transaction, so readers never see a partial import, and
// bumps its version so clients refetch their cached tiles. Does nothing if the objects are the same
// as what we already have.
fun replace(collection: ReplacedCollection) {
  logger.info(
      "Fetched {} lines, {} points, and {} polygons for {}",
      collection.lines.size,
      collection.points.size,
      collection.polygons.size,
      collection.name)
  createBaseConnection().use { hikari ->
    hikari.connection.use { connection ->
      connection.autoCommit = false

      // The anonymous user owns it so that it's public, see ApiServer.kt#getCollectionAccess.
      connection
          .prepareStatement(
              "INSERT INTO collections (id, creator, name, covering) VALUES (?, ?, ?, ?) "
                  + "ON CONFLICT (id) DO NOTHING")
          .apply {
            setObject(1, collection.id)
            setObject(2, UUID(0, 0))
            setString(3, collection.name)
            setBytes(4, encodeCovering(listOf()))
          }
          .executeUpdate()
      val version =
          connection
              .prepareStatement("SELECT version FROM collections WHERE id = ? FOR UPDATE")
              .apply {
                setObject(1, collection.id)
              }
              .executeQuery()
              .use {
                it.next()
                it.getLong(1) + 1
              }
      if (unchanged(connection, collection)) {
        logger.info("{} is unchanged", collection.name)
        connection.rollback()
        return
      }

      for (table in listOf("lines", "points", "polygons")) {
        connection
            .prepareStatement("DELETE FROM ${table} WHERE collection = ?")
            .apply {
              setObject(1, collection.id)
            }
            .executeUpdate()
      }

      // COPY can't write into views, and the connection's schema only has views, so we name the
      // public tables directly.
      val copier = CopyManager(connection.unwrap(PgConnection::class.java))
      copier.copyIn(
          "COPY public.lines (id, collection, cell, data, lat_lng_degrees) "
              + "FROM STDIN WITH (FORMAT CSV, HEADER)",
          toCsv(collection.id, collection.lines) { it })
      copier.copyIn(
          "COPY public.points (id, collection, cell, data, lat_lng_degrees) "
              + "FROM STDIN WITH (FORMAT CSV, HEADER)",
          toCsv(collection.id, collection.points) { it })
      copier.copyIn(
          "COPY public.polygons (id, collection, cell, data, s2_polygon) "
              + "FROM STDIN WITH (FORMAT CSV, HEADER)",
          toCsv(collection.id, collection.polygons, ::encodePolygon))

      connection
          .prepareStatement(
              "UPDATE collections SET covering = ?, version = ?, schema = ?::jsonb WHERE id = ?")
          .apply {
            setBytes(
                1,
                encodeCovering(
                    collection.lines.map { it.cell }
                        + collection.points.map { it.cell }
                        + collection.polygons.map { it.cell }))
            setLong(2, version)
            setString(3, mapper.writeValueAsString(collection.schema))
            setObject(4, collection.id)
          }
          .executeUpdate()

      connection.commit()
    }
  }
}

// Compares data and geometry but not ids, because air quality contours get new ids every run.
private fun unchanged(connection: Connection, collection: ReplacedCollection): Boolean {
  val schema =
      connection
          .prepareStatement("SELECT schema FROM collections WHERE id = ?")
          .apply {
            setObject(1, collection.id)
          }
          .executeQuery()
          .use {
            it.next()
            it.getString(1)
          }
  if (schema == null || mapper.readTree(schema) != mapper.valueToTree(collection.schema)) {
    return false
  }

  val stored = ArrayList<String>()
  val tables =
      listOf(
          "lines" to "lat_lng_degrees",
          "points" to "lat_lng_degrees",
          "polygons" to "s2_polygon",
      )
  for ((table, geometry) in tables) {
    connection
        .prepareStatement("SELECT data, ${geometry} FROM ${table} WHERE collection = ?")
        .apply {
          setObject(1, collection.id)
        }
        .executeQuery()
        .use {
          while (it.next()) {
            stored.add(
                rowKey(
                    mapper.readValue(it.getString(1), Map::class.java) as Map<String, String>,
                    it.getBytes(2)))
          }
        }
  }
  val fetched =
      collection.lines.map { rowKey(it.data, it.geometry) } +
          collection.points.map { rowKey(it.data, it.geometry) } +
          collection.polygons.map { rowKey(it.data, encodePolygon(it.geometry)) }
  return stored.sorted() == fetched.sorted()
}

private fun rowKey(data: Map<String, String>, geometry: ByteArray): String =
    mapper.writeValueAsString(TreeMap(data)) + Base64.getEncoder().encodeToString(geometry)

private fun encodePolygon(polygon: S2Polygon): ByteArray =
    ByteArrayOutputStream().also { polygon.encode(it) }.toByteArray()

private fun <G> toCsv(
    collection: UUID, rows: List<Row<G>>, encode: (G) -> ByteArray): StringifyingInputStream<Row<G>> {
  return StringifyingInputStream(rows.iterator()) { row, csv ->
    // id,collection,cell,data,geometry
    csv.append(row.id)
    csv.append(",")
    csv.append(collection)
    csv.append(",")
    csv.append(row.cell.id())
    csv.append(",")
    csv.append(StringEscapeUtils.escapeCsv(mapper.writeValueAsString(row.data)))
    csv.append(",")
    appendByteArray(encode(row.geometry), csv)
    csv.append("\n")
  }
}
