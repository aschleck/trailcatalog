package lat.trails.importers

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.google.common.geometry.S2LatLng
import java.time.Duration
import java.time.Instant
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.time.temporal.ChronoUnit
import java.util.UUID
import kotlin.system.exitProcess
import org.slf4j.LoggerFactory
import org.trailcatalog.flags.parseFlags

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

private val FIRE_PERIMETERS_SCHEMA =
    schema(
        listOf(
            field("type", "Type", mapOf("RX" to "Prescribed fire", "WF" to "Wildfire")),
            field("acres", "Acres"),
            field("contained", "Contained"),
            field("discovered", "Discovered"),
            field("mapped", "Perimeter mapped"),
            field("incident", "Incident"),
        ),
        listOf(
            polygonLayer(listOf(stringEquals("type", "RX")), "#FFA00066"),
            polygonLayer(listOf(ALWAYS), "#E8200088"),
        ),
    )

// AirNow's category colors. We don't draw Good because most of the country is Good, and drawing
// it would cover the map in green.
// https://www.airnow.gov/aqi/aqi-basics/
private val AIR_QUALITY_SCHEMA =
    schema(
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
        listOf(
            "2" to "#FFFF0066",
            "3" to "#FF7E0077",
            "4" to "#FF000077",
            "5" to "#8F3F9788",
            "6" to "#7E002388",
        ).map { (category, fill) ->
          polygonLayer(listOf(stringEquals("category", category)), fill)
        },
    )

// The same colors water.noaa.gov uses for its gauges
private val RIVER_GAUGES_SCHEMA =
    schema(
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
        listOf(
            "major" to "#CC33FFFF",
            "moderate" to "#FF0000FF",
            "minor" to "#FF9900FF",
            "action" to "#FFFF00FF",
            "no_flooding" to "#00C000FF",
            "low_threshold" to "#A0522DFF",
            "not_defined" to "#9E9E9EFF",
        ).map { (flood, fill) ->
          pointLayer(listOf(stringEquals("flood", flood)), fill)
        },
    )

private val BURNT_AREAS_SCHEMA =
    schema(
        listOf(
            field("hectares", "Hectares"),
            field("detected", "Detected"),
            field("updated", "Updated"),
            field("natura2000", "In Natura 2000"),
            field("country", "Country"),
        ),
        listOf(
            polygonLayer(listOf(stringEquals("recent", "true")), "#E8200088"),
            polygonLayer(listOf(ALWAYS), "#80303066"),
        ),
    )

// The EEA's band colors and names
// https://airindex.eea.europa.eu/AQI/index.html
private val EUROPEAN_AIR_QUALITY_SCHEMA =
    schema(
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
        listOf(
            "1" to "#50F0E6FF",
            "2" to "#50CCAAFF",
            "3" to "#F0E641FF",
            "4" to "#FF5050FF",
            "5" to "#960032FF",
            "6" to "#7D2181FF",
        ).map { (band, fill) ->
          pointLayer(listOf(stringEquals("band", band)), fill)
        },
    )

// Gauges with these statuses still list their last reading, which can be old, so we skip them.
private val STALE_FLOOD_CATEGORIES = setOf("obs_not_current", "out_of_service")

private val DATE_FORMAT = DateTimeFormatter.ISO_LOCAL_DATE.withZone(ZoneOffset.UTC)
private val TIME_FORMAT = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm 'UTC'").withZone(ZoneOffset.UTC)
// The EEA's hourly files are named like 2026-10-13T04.json
private val HOUR_FORMAT = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH").withZone(ZoneOffset.UTC)

private val mapper = ObjectMapper()

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

private fun firePerimeters(): ReplacedCollection {
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
  return ReplacedCollection(
      FIRE_PERIMETERS_COLLECTION_ID,
      "WFIGS current interagency fire perimeters",
      FIRE_PERIMETERS_SCHEMA,
      polygons = polygons)
}

private fun airQuality(): ReplacedCollection {
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
  return ReplacedCollection(
      AIR_QUALITY_COLLECTION_ID,
      "AirNow current air quality",
      AIR_QUALITY_SCHEMA,
      polygons = polygons)
}

private fun riverGauges(): ReplacedCollection {
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
    points.add(pointRow(RIVER_GAUGES_COLLECTION_ID, lid, data, latLng))
  }
  return ReplacedCollection(
      RIVER_GAUGES_COLLECTION_ID, "NWPS river gauges", RIVER_GAUGES_SCHEMA, points = points)
}

private fun burntAreas(): ReplacedCollection {
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
  return ReplacedCollection(
      BURNT_AREAS_COLLECTION_ID, "EFFIS burnt areas", BURNT_AREAS_SCHEMA, polygons = polygons)
}

private fun europeanAirQuality(): ReplacedCollection {
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
    points.add(pointRow(EUROPEAN_AIR_QUALITY_COLLECTION_ID, code, data, latLng))
  }
  return ReplacedCollection(
      EUROPEAN_AIR_QUALITY_COLLECTION_ID,
      "EEA European Air Quality Index",
      EUROPEAN_AIR_QUALITY_SCHEMA,
      points = points)
}

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

// ArcGIS sends dates as milliseconds since the epoch.
private fun toInstant(millis: Double): Instant = Instant.ofEpochMilli(millis.toLong())
