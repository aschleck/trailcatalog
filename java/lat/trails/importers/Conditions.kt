package lat.trails.importers

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.google.common.geometry.S2CellId
import com.google.common.geometry.S2LatLng
import com.google.common.geometry.S2Polygon
import java.io.ByteArrayOutputStream
import java.sql.Connection
import java.time.Duration
import java.time.Instant
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.time.temporal.ChronoUnit
import java.util.Base64
import java.util.TreeMap
import java.util.UUID
import kotlin.system.exitProcess
import lat.trails.common.createBaseConnection
import lat.trails.common.encodeCovering
import org.apache.commons.text.StringEscapeUtils
import org.postgresql.copy.CopyManager
import org.postgresql.jdbc.PgConnection
import org.slf4j.LoggerFactory
import org.trailcatalog.common.DeltaLatLngE7
import org.trailcatalog.flags.parseFlags
import org.trailcatalog.importers.basemap.StringifyingInputStream
import org.trailcatalog.importers.basemap.appendByteArray
import org.trailcatalog.s2.SimpleS2
import org.trailcatalog.s2.polygonToCell

private val logger = LoggerFactory.getLogger("Conditions")

// Keep in sync with viewer_controller.ts
private val AIR_QUALITY_COLLECTION_ID = UUID.fromString("09afe7ea-ffe9-41b3-ac05-580758a5ac2f")
private val BURNT_AREAS_COLLECTION_ID = UUID.fromString("c0e8127d-7dd0-4eca-83e8-19a3abda8620")
private val EUROPEAN_AIR_QUALITY_COLLECTION_ID =
    UUID.fromString("51787c46-2a9e-4374-b26a-50b7475608e1")
private val FIRE_PERIMETERS_COLLECTION_ID = UUID.fromString("77ac6377-5725-40bb-bfb5-c0bbcb353617")
private val RIVER_GAUGES_COLLECTION_ID = UUID.fromString("b94ce6bf-753b-4886-8dde-224d5ebcfb7a")

// https://data-nifc.opendata.arcgis.com/datasets/nifc::wfigs-current-interagency-fire-perimeters
private const val FIRE_PERIMETERS_URL =
    "https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services" +
        "/WFIGS_Interagency_Perimeters_Current/FeatureServer/0/query"

// https://www.arcgis.com/home/item.html?id=ad7046a2b3854c25aea8945b3baac0a7
private const val AIR_QUALITY_URL =
    "https://services.arcgis.com/cJ9YHowT8TU7DUyn/arcgis/rest/services" +
        "/AirNowLatestContoursCombined/FeatureServer/0/query"

// The latest reading from every gauge, regenerated every few minutes. We use this instead of the
// NWPS API because the API rate limits hard and takes a minute to list every gauge.
// https://water.noaa.gov/about/gis-data
private const val RIVER_GAUGES_URL =
    "https://water.noaa.gov/resources/downloads/shapefiles/national_shapefile_obs.tgz"

// Burnt areas mapped in the last 30 days. EFFIS maps them from MODIS and VIIRS twice a day.
// https://forest-fire.emergency.copernicus.eu/applications/data-and-services
private const val BURNT_AREAS_URL =
    "https://maps.effis.emergency.copernicus.eu/effis?service=WFS&version=1.1.0" +
        "&request=GetFeature&typename=ms:modis.ba.poly.month&outputformat=geojson"

// The station index behind the EEA's viewer. The EEA doesn't document it, but its documented
// download service hands out a year of readings per station and pollutant, so an hour of Europe
// costs about 2.2 GB there and 160 kB here.
// https://airindex.eea.europa.eu/AQI/index.html
private const val EUROPEAN_AIR_QUALITY_URL =
    "https://dis2datalake.blob.core.windows.net/airquality-derivated/AQI-noRunningMeans/"

// Every hour from now on is a CAMS forecast, and the EEA's viewer opens three hours back.
private val EUROPEAN_AIR_QUALITY_LAG = Duration.ofHours(3)

private val AIR_QUALITY_CATEGORIES =
    listOf(
        "Good",
        "Moderate",
        "Unhealthy for sensitive groups",
        "Unhealthy",
        "Very unhealthy",
        "Hazardous",
    )

private val FIRE_PERIMETERS_PRESENTATION =
    mapOf(
        "title" to "name",
        "fields" to
            listOf(
                field("type", "Type", mapOf("RX" to "Prescribed fire", "WF" to "Wildfire")),
                field("acres", "Acres"),
                field("contained", "Contained"),
                field("discovered", "Discovered"),
                field("mapped", "Perimeter mapped"),
                field("incident", "Incident"),
            ),
        "polygons" to
            listOf(
                mapOf("filters" to listOf(stringEquals("type", "RX")), "fill" to "#FFA00066"),
                mapOf("filters" to listOf(ALWAYS), "fill" to "#E8200088"),
            ),
    )

// AirNow's category colors. We don't draw Good because most of the country is Good, and drawing
// it would cover the map in green.
// https://www.airnow.gov/aqi/aqi-basics/
private val AIR_QUALITY_PRESENTATION =
    mapOf(
        "title" to "name",
        "fields" to
            listOf(
                field(
                    "category",
                    "Air quality index",
                    mapOf(
                        "1" to "Good (0 to 50)",
                        "2" to "Moderate (51 to 100)",
                        "3" to "Unhealthy for sensitive groups (101 to 150)",
                        "4" to "Unhealthy (151 to 200)",
                        "5" to "Very unhealthy (201 to 300)",
                        "6" to "Hazardous (301 and up)",
                    )),
                field("observed", "Observed"),
            ),
        "polygons" to
            listOf(
                "2" to "#FFFF0066",
                "3" to "#FF7E0077",
                "4" to "#FF000077",
                "5" to "#8F3F9788",
                "6" to "#7E002388",
            ).map { (category, fill) ->
              mapOf("filters" to listOf(stringEquals("category", category)), "fill" to fill)
            },
    )

// The same colors water.noaa.gov uses for its gauges
private val RIVER_GAUGES_PRESENTATION =
    mapOf(
        "title" to "name",
        "fields" to
            listOf(
                field(
                    "flood",
                    "Status",
                    mapOf(
                        "action" to "Near flood stage",
                        "low_threshold" to "Below low water threshold",
                        "major" to "Major flooding",
                        "minor" to "Minor flooding",
                        "moderate" to "Moderate flooding",
                        "no_flooding" to "Not flooding",
                        "not_defined" to "No flood stages defined",
                    )),
                field("waterbody", "Waterbody"),
                field("stage", "Stage"),
                field("flow", "Flow"),
                field("observed", "Observed"),
                field("gauge", "Gauge"),
            ),
        "points" to
            listOf(
                "major" to "#CC33FFFF",
                "moderate" to "#FF0000FF",
                "minor" to "#FF9900FF",
                "action" to "#FFFF00FF",
                "no_flooding" to "#00C000FF",
                "low_threshold" to "#A0522DFF",
                "not_defined" to "#9E9E9EFF",
            ).map { (flood, fill) ->
              mapOf(
                  "filters" to listOf(stringEquals("flood", flood)),
                  "fill" to fill,
                  "stroke" to "#000000FF",
                  "radius" to 4,
              )
            },
    )

private val BURNT_AREAS_PRESENTATION =
    mapOf(
        "title" to "name",
        "fields" to
            listOf(
                field("hectares", "Hectares"),
                field("detected", "Detected"),
                field("updated", "Updated"),
                field("natura2000", "In Natura 2000"),
                field("country", "Country"),
            ),
        "polygons" to
            listOf(
                mapOf("filters" to listOf(stringEquals("recent", "true")), "fill" to "#E8200088"),
                mapOf("filters" to listOf(ALWAYS), "fill" to "#80303066"),
            ),
    )

// The EEA's band colors and names
// https://airindex.eea.europa.eu/AQI/index.html
private val EUROPEAN_AIR_QUALITY_PRESENTATION =
    mapOf(
        "title" to "name",
        "fields" to
            listOf(
                field(
                    "band",
                    "Air quality index",
                    mapOf(
                        "1" to "Good",
                        "2" to "Fair",
                        "3" to "Moderate",
                        "4" to "Poor",
                        "5" to "Very poor",
                        "6" to "Extremely poor",
                    )),
                field(
                    "complete",
                    "Pollutants",
                    mapOf(
                        "true" to "Enough for the full index",
                        "false" to "Too few for the full index",
                    )),
                field("hour", "Hour"),
                field("type", "Station type"),
                field("area", "Area"),
                field("network", "Network"),
                field("station", "Station"),
            ),
        "points" to
            listOf(
                "1" to "#50F0E6FF",
                "2" to "#50CCAAFF",
                "3" to "#F0E641FF",
                "4" to "#FF5050FF",
                "5" to "#960032FF",
                "6" to "#7D2181FF",
            ).map { (band, fill) ->
              mapOf(
                  "filters" to listOf(stringEquals("band", band)),
                  "fill" to fill,
                  "stroke" to "#000000FF",
                  "radius" to 4,
              )
            },
    )

// Gauges with these statuses still list their last reading, which can be old, so we skip them.
private val STALE_FLOOD_CATEGORIES = setOf("obs_not_current", "out_of_service")

private val DATE_FORMAT = DateTimeFormatter.ISO_LOCAL_DATE.withZone(ZoneOffset.UTC)
private val TIME_FORMAT = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm 'UTC'").withZone(ZoneOffset.UTC)
// The EEA's hourly files are named like 2026-10-13T04.json
private val HOUR_FORMAT = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH").withZone(ZoneOffset.UTC)

private val mapper = ObjectMapper()

private data class Row<G>(val id: UUID, val data: Map<String, String>, val cell: S2CellId, val geometry: G)

private class Collection(
    val id: UUID,
    val name: String,
    // the JSON for collections.presentation, see collection_layer.ts#Presentation
    val presentation: Map<String, Any>,
    val polygons: List<Row<S2Polygon>> = listOf(),
    // encoded with DeltaLatLngE7
    val points: List<Row<ByteArray>> = listOf(),
)

fun main(args: Array<String>) {
  parseFlags(args)

  var failed = false
  val fetches =
      listOf(::firePerimeters, ::airQuality, ::riverGauges, ::burntAreas, ::europeanAirQuality)
  for (fetch in fetches) {
    try {
      replace(fetch())
    } catch (e: Exception) {
      // Keep going so one source being down doesn't stop the others from updating.
      logger.error("Failed to import {}", fetch.name, e)
      failed = true
    }
  }
  if (failed) {
    exitProcess(1)
  }
}

private fun firePerimeters(): Collection {
  val polygons =
      fetchArcGis(
          FIRE_PERIMETERS_URL,
          "attr_IncidentName,poly_IncidentName,attr_IncidentTypeCategory,poly_GISAcres," +
              "attr_PercentContained,attr_FireDiscoveryDateTime,poly_PolygonDateTime," +
              "attr_UniqueFireIdentifier")
          .mapNotNull { feature ->
            val properties = feature["properties"]
            val data = HashMap<String, String>()
            (properties.text("attr_IncidentName") ?: properties.text("poly_IncidentName"))
                ?.let { data["name"] = it }
            properties.text("attr_IncidentTypeCategory")?.let { data["type"] = it }
            properties.number("poly_GISAcres")?.let { data["acres"] = "%,d".format(Math.round(it)) }
            properties.number("attr_PercentContained")
                ?.let { data["contained"] = "${Math.round(it)}%" }
            properties.number("attr_FireDiscoveryDateTime")
                ?.let { data["discovered"] = DATE_FORMAT.format(toInstant(it)) }
            properties.number("poly_PolygonDateTime")
                ?.let { data["mapped"] = DATE_FORMAT.format(toInstant(it)) }
            val incident = properties.text("attr_UniqueFireIdentifier")
            incident?.let { data["incident"] = it }
            polygonRow(FIRE_PERIMETERS_COLLECTION_ID, incident, data, feature["geometry"])
          }
  return Collection(
      FIRE_PERIMETERS_COLLECTION_ID,
      "WFIGS current interagency fire perimeters",
      FIRE_PERIMETERS_PRESENTATION,
      polygons)
}

private fun airQuality(): Collection {
  val polygons =
      fetchArcGis(AIR_QUALITY_URL, "gridcode,Timestamp").mapNotNull { feature ->
        val properties = feature["properties"]
        val category = properties.number("gridcode")!!.toInt()
        val data =
            hashMapOf(
                "name" to "Air quality: ${AIR_QUALITY_CATEGORIES[category - 1]}",
                "category" to category.toString(),
            )
        properties.number("Timestamp")
            ?.let { data["observed"] = TIME_FORMAT.format(toInstant(it)) }
        // Contours don't have ids, so each run gets new ones.
        polygonRow(AIR_QUALITY_COLLECTION_ID, null, data, feature["geometry"])
      }
  return Collection(
      AIR_QUALITY_COLLECTION_ID, "AirNow current air quality", AIR_QUALITY_PRESENTATION, polygons)
}

private fun riverGauges(): Collection {
  val shapefile = readTar(gunzip(fetchBytes(RIVER_GAUGES_URL)))
  val points = ArrayList<Row<ByteArray>>()
  // The .dbf rows include latitude and longitude, so we don't need to read the .shp.
  for (gauge in readDbf(shapefile.entries.single { it.key.endsWith(".dbf") }.value)) {
    val flood = gauge["Status"]
    if (flood == null || STALE_FLOOD_CATEGORIES.contains(flood)) {
      continue
    }

    val lid = gauge["GaugeLID"]!!
    val data = hashMapOf("flood" to flood, "gauge" to lid)
    gauge["Location"]?.let { data["name"] = it }
    gauge["Waterbody"]?.let { data["waterbody"] = it }
    gauge["Observed"]?.let { data["stage"] = "${it} ${gauge["Units"] ?: ""}".trim() }
    gauge["SecValue"]?.let { data["flow"] = "${it} ${gauge["SecUnit"] ?: ""}".trim() }
    // UTC, formatted like 2026-10-04 04:30:00
    gauge["ObsTime"]?.let { data["observed"] = "${it.removeSuffix(":00")} UTC" }

    val latLng = S2LatLng.fromDegrees(gauge["Latitude"]!!.toDouble(), gauge["Longitude"]!!.toDouble())
    val latLngE7 = intArrayOf(latLng.lat().e7(), latLng.lng().e7())
    points.add(
        Row(
            stableId(RIVER_GAUGES_COLLECTION_ID, lid),
            data,
            S2CellId.fromLatLng(latLng).parent(SimpleS2.HIGHEST_INDEX_LEVEL),
            DeltaLatLngE7.encode(latLngE7)))
  }
  return Collection(
      RIVER_GAUGES_COLLECTION_ID, "NWPS river gauges", RIVER_GAUGES_PRESENTATION, points = points)
}

private fun burntAreas(): Collection {
  val polygons =
      fetchJson(BURNT_AREAS_URL)["features"].mapNotNull { feature ->
        val properties = feature["properties"]
        // Formatted like 2026-09-13 00:00:00, in UTC
        val detected = properties.text("FIREDATE")!!.substringBefore(" ")
        val hectares = properties.text("AREA_HA")!!.toDouble()
        val place =
            listOfNotNull(properties.text("COMMUNE"), properties.text("PROVINCE"))
                .filter { it != "N.A." }
                .firstOrNull()
        val data =
            hashMapOf(
                "name" to if (place != null) "Burnt area near ${place}" else "Burnt area",
                "hectares" to "%,d".format(Math.round(hectares)),
                "detected" to detected,
                // CLASS is 1DAY, 7DAYS, or 30DAYS, or FireSeason for an area EFFIS has updated
                // since the start of the season
                "recent" to (properties.text("CLASS") in setOf("1DAY", "7DAYS")).toString(),
            )
        properties.text("LASTUPDATE")?.let { data["updated"] = it.substringBefore(" ") }
        properties.text("COUNTRY")?.let { data["country"] = it }
        properties.text("PERCNA2K")
            ?.toDouble()
            ?.takeIf { it > 0 }
            ?.let { data["natura2000"] = "${Math.round(it)}%" }
        polygonRow(BURNT_AREAS_COLLECTION_ID, properties.text("id"), data, feature["geometry"])
      }
  return Collection(
      BURNT_AREAS_COLLECTION_ID, "EFFIS burnt areas", BURNT_AREAS_PRESENTATION, polygons)
}

private fun europeanAirQuality(): Collection {
  // Named like raw_stations.json.26100900, so the newest sorts last
  val stationsFile =
      fetchJson("${EUROPEAN_AIR_QUALITY_URL}content/index.json")["contents"]
          .map { it.asText() }
          .max()
  val stations = fetchJson("${EUROPEAN_AIR_QUALITY_URL}content/${stationsFile}")
  val hour = Instant.now().truncatedTo(ChronoUnit.HOURS).minus(EUROPEAN_AIR_QUALITY_LAG)
  // Keys are station codes, with a code_cp of 2 when the station measures enough pollutants for
  // the full index and 1 when it doesn't.
  val indices =
      fetchJson("${EUROPEAN_AIR_QUALITY_URL}map/${HOUR_FORMAT.format(hour)}.json")

  val points = ArrayList<Row<ByteArray>>()
  for (station in stations) {
    val code = station.text("code")!!
    // The viewer floors the index to pick a band
    val band = indices.number(code)?.toInt() ?: continue
    if (band < 1) {
      continue
    }

    val data =
        hashMapOf(
            "band" to band.toString(),
            "complete" to (indices.number("${code}_cp") == 2.0).toString(),
            "hour" to TIME_FORMAT.format(hour),
            "station" to code,
        )
    station.text("name")?.let { data["name"] = it }
    station.text("station_type")?.let { data["type"] = it }
    station.text("area_classification")?.let { data["area"] = it }
    station.text("network")?.let { data["network"] = it }

    val latLng = S2LatLng.fromDegrees(station.number("lat")!!, station.number("lon")!!)
    points.add(
        Row(
            stableId(EUROPEAN_AIR_QUALITY_COLLECTION_ID, code),
            data,
            S2CellId.fromLatLng(latLng).parent(SimpleS2.HIGHEST_INDEX_LEVEL),
            DeltaLatLngE7.encode(intArrayOf(latLng.lat().e7(), latLng.lng().e7()))))
  }
  return Collection(
      EUROPEAN_AIR_QUALITY_COLLECTION_ID,
      "EEA European Air Quality Index",
      EUROPEAN_AIR_QUALITY_PRESENTATION,
      points = points)
}

private fun polygonRow(
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

// Gives an object the same id on every run, so a client that has it selected keeps it selected
// after an import.
private fun stableId(collection: UUID, key: String): UUID =
    UUID.nameUUIDFromBytes("${collection}/${key}".toByteArray())

// Fetches every feature in a layer, in pages because ArcGIS returns at most 2000 per request.
private fun fetchArcGis(url: String, outFields: String): List<JsonNode> {
  val features = ArrayList<JsonNode>()
  while (true) {
    val page =
        fetchJson(
            "${url}?where=1%3D1&outSR=4326&orderByFields=OBJECTID&f=geojson" +
                "&resultOffset=${features.size}&outFields=${outFields}")
    features.addAll(page["features"])
    if (!page.path("properties").path("exceededTransferLimit").asBoolean(false)) {
      return features
    }
  }
}

private fun fetchJson(url: String): JsonNode {
  val json = mapper.readTree(fetchBytes(url))
  // ArcGIS returns errors as a 200 with an error object
  check(!json.has("error")) { "${url} failed: ${json["error"]}" }
  return json
}

private fun JsonNode.text(key: String): String? =
    get(key)?.takeUnless { it.isNull }?.asText()?.trim()?.takeIf { it.isNotEmpty() }

private fun JsonNode.number(key: String): Double? = get(key)?.takeIf { it.isNumber }?.asDouble()

// ArcGIS sends dates as milliseconds since the epoch.
private fun toInstant(millis: Double): Instant = Instant.ofEpochMilli(millis.toLong())

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
private fun replace(collection: Collection) {
  logger.info(
      "Fetched {} polygons and {} points for {}",
      collection.polygons.size,
      collection.points.size,
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

      for (table in listOf("points", "polygons")) {
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
          "COPY public.polygons (id, collection, cell, data, s2_polygon) "
              + "FROM STDIN WITH (FORMAT CSV, HEADER)",
          toCsv(collection.id, collection.polygons, ::encodePolygon))
      copier.copyIn(
          "COPY public.points (id, collection, cell, data, lat_lng_degrees) "
              + "FROM STDIN WITH (FORMAT CSV, HEADER)",
          toCsv(collection.id, collection.points) { it })

      connection
          .prepareStatement(
              "UPDATE collections SET covering = ?, version = ?, presentation = ?::jsonb WHERE id = ?")
          .apply {
            setBytes(
                1,
                encodeCovering(
                    collection.polygons.map { it.cell } + collection.points.map { it.cell }))
            setLong(2, version)
            setString(3, mapper.writeValueAsString(collection.presentation))
            setObject(4, collection.id)
          }
          .executeUpdate()

      connection.commit()
    }
  }
}

// Compares data and geometry but not ids, because air quality contours get new ids every run.
private fun unchanged(connection: Connection, collection: Collection): Boolean {
  val presentation =
      connection
          .prepareStatement("SELECT presentation FROM collections WHERE id = ?")
          .apply {
            setObject(1, collection.id)
          }
          .executeQuery()
          .use {
            it.next()
            it.getString(1)
          }
  if (presentation == null
      || mapper.readTree(presentation) != mapper.valueToTree(collection.presentation)) {
    return false
  }

  val stored = ArrayList<String>()
  for ((table, geometry) in listOf("polygons" to "s2_polygon", "points" to "lat_lng_degrees")) {
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
      collection.polygons.map { rowKey(it.data, encodePolygon(it.geometry)) } +
          collection.points.map { rowKey(it.data, it.geometry) }
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
