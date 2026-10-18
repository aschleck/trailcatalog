package lat.trails.importers

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.google.common.geometry.S2LatLng
import java.util.UUID
import kotlin.system.exitProcess
import org.slf4j.LoggerFactory
import org.trailcatalog.flags.parseFlags

private val logger = LoggerFactory.getLogger("AviationVectors")

// Keep in sync with layer_catalog.ts
private val AIRSPACE_COLLECTION_ID = UUID.fromString("6febd392-9760-431a-aa30-fa5b0dfcc411")
private val AIRPORTS_COLLECTION_ID = UUID.fromString("c885dc7e-291d-4628-bc8b-7f63231b087a")
private val NAVAIDS_COLLECTION_ID = UUID.fromString("73c9b4f8-720b-407d-a503-736dfca2490f")
private val REPORTING_POINTS_COLLECTION_ID = UUID.fromString("44fc1319-eae1-4051-8b07-6b1ad24e8861")
private val WEATHER_STATIONS_COLLECTION_ID = UUID.fromString("1710b392-414f-4945-b8d3-3c1e13a5436e")

// openAIP regenerates every country's exports daily and only links them from this page, as signed
// URLs that expire after a day. The page embeds its listing as a script object, which we read with
// regexes because it isn't JSON.
// https://www.openaip.net/data/exports
private const val OPENAIP_EXPORTS_URL =
    "https://www.openaip.net/data/exports?format=ndgeojson&limit=1000&page="

// Every station the Aviation Weather Center knows, regenerated daily
// https://aviationweather.gov/data/api/#cache
private const val WEATHER_STATIONS_URL =
    "https://aviationweather.gov/data/cache/stations.cache.json.gz"

// The enums below are indexed by openAIP's codes.
// https://docs.openaip.net/
private val AIRSPACE_TYPES =
    listOf(
        "Other",
        "Restricted",
        "Danger",
        "Prohibited",
        "Control zone (CTR)",
        "Transponder mandatory zone (TMZ)",
        "Radio mandatory zone (RMZ)",
        "Terminal maneuvering area (TMA)",
        "Temporary reserved area (TRA)",
        "Temporary segregated area (TSA)",
        "Flight information region (FIR)",
        "Upper flight information region (UIR)",
        "Air defense identification zone (ADIZ)",
        "Aerodrome traffic zone (ATZ)",
        "Military aerodrome traffic zone (MATZ)",
        "Airway",
        "Military training route (MTR)",
        "Alert area",
        "Warning area",
        "Protected area",
        "Helicopter traffic zone (HTZ)",
        "Gliding sector",
        "Transponder setting (TRP)",
        "Traffic information zone (TIZ)",
        "Traffic information area (TIA)",
        "Military training area (MTA)",
        "Control area (CTA)",
        "ACC sector",
        "Aerial sporting or recreational activity",
        "Low altitude overflight restriction",
        "Military route (MRT)",
        "TSA/TRA feeding route (TFR)",
        "VFR sector",
        "FIS sector",
        "Lower traffic area (LTA)",
        "Upper traffic area (UTA)",
        "Military control zone (MCTR)",
    )

// FIRs, UIRs, ACC and FIS sectors, and UTAs divide up the sky between controllers and cover whole
// countries, and airways and military routes are corridors for traffic en route. None of them
// tells someone on the ground anything.
private val SKIPPED_AIRSPACE_TYPES = setOf(10, 11, 15, 16, 27, 30, 31, 33, 35)

// ICAO calls everything from FL195 up upper airspace, which only en route traffic flies in. A
// floor of FL195 is about 5,900 m, above all but a few of the world's summits.
private const val UPPER_AIRSPACE_FEET = 19_500.0

// Class E from 1,200 ft AGL up covers most of the US and much of Europe, and sectional charts
// don't draw it. Class E down to 700 ft AGL or the surface is what marks the airspace around an
// airport with instrument approaches.
private const val CLASS_E_FLOOR_FEET = 700.0

// Index 7 is unused and 8 is special use airspace, which has no class.
private val ICAO_CLASSES = listOf("A", "B", "C", "D", "E", "F", "G")

private val AIRSPACE_ACTIVITIES =
    listOf(
        null,
        "Parachuting",
        "Aerobatics",
        "Aeroclub and aerial work",
        "Ultralights",
        "Hang gliding and paragliding",
        // Missing from the spec, but every airspace with it is a model airfield or a drone area
        "Model aircraft and drones",
    )

private val AIRPORT_TYPES =
    listOf(
        "Airport",
        "Glider site",
        "Airfield",
        "International airport",
        "Military heliport",
        "Military aerodrome",
        "Ultralight site",
        "Heliport",
        "Closed aerodrome",
        "IFR airport",
        "Water aerodrome",
        "Landing strip",
        "Agricultural landing strip",
        "Altiport",
    )

private val NAVAID_TYPES =
    listOf("DME", "TACAN", "NDB", "VOR", "VOR-DME", "VORTAC", "DVOR", "DVOR-DME", "DVORTAC")

// A palette taken from the sectional charts' inks, which are muted enough to sit on the basemap's
// greens without shouting over it.
private const val CHART_BLUE = "#2f5f9e"
private const val CHART_NAVY = "#1f3a68"
private const val CHART_MAGENTA = "#9c2a73"
private const val CHART_RED = "#b3261e"
private const val CHART_AMBER = "#c77700"
private const val CHART_VIOLET = "#6a4c93"
private const val CHART_GREEN = "#2e7d4f"
private const val CHART_TEAL = "#0f8b8d"
private const val CHART_SLATE = "#4a5568"
private const val CHART_GRAY = "#8a8f98"

// Controlled airspace is drawn the way sectional charts draw it: Class B solid blue, C solid
// magenta, D dashed blue, and E dashed magenta at the surface and a faded magenta band from 700
// ft. Special use airspace gets ticks like the charts' hatching, red where entry is restricted and
// amber where it's hazardous.
//
// Nothing is filled, because airspace stacks in shelves and the fills would add up to a blot over
// the busiest airports.
private val AIRSPACE_SCHEMA =
    schema(
        listOf(
            field("type", "Type"),
            field("class", "Class"),
            field("floor", "Floor"),
            field("ceiling", "Ceiling"),
            field("activity", "Activity"),
            field("activation", "Activation"),
            field("country", "Country"),
        ),
        // prohibited, restricted, and danger, then alert, warning, and low overflight
        byType(listOf(3), CHART_RED, 2, "ticks")
            + byType(listOf(1, 2), CHART_RED, 1, "ticks")
            + byType(listOf(17, 18, 29), CHART_AMBER, 1, "ticks")
            // military: TRA, TSA, MATZ, MTA, and MCTR
            + byType(listOf(8, 9, 14, 25, 36), CHART_VIOLET, 1, "ticks")
            // gliding sectors and sporting activity, which in the US are parachute jump areas
            + byType(listOf(21, 28), CHART_GREEN, 1, "dashed")
            + byClass("B", CHART_BLUE, 2, "solid")
            + byClass("C", CHART_MAGENTA, 2, "solid")
            + byClass("D", CHART_BLUE, 2, "dashed")
            + byClass("E", CHART_MAGENTA, 1, "dashed", stringEquals("floor", "Surface"))
            + byClass("E", CHART_MAGENTA + "33", 4, "solid")
            + outlinedPolygonLayer(listOf(ALWAYS), CHART_SLATE + "99", 1, "dashed"),
    )

private fun byType(types: List<Int>, stroke: String, widthPx: Int, pattern: String) =
    types.map {
      outlinedPolygonLayer(
          listOf(stringEquals("type", AIRSPACE_TYPES[it])), stroke, widthPx, pattern)
    }

private fun byClass(
    icaoClass: String,
    stroke: String,
    widthPx: Int,
    pattern: String,
    vararg filters: Map<String, Any>,
) =
    outlinedPolygonLayer(
        listOf(stringEquals("class", icaoClass)) + filters, stroke, widthPx, pattern)

private val AIRPORTS_SCHEMA =
    schema(
        listOf(
            field("type", "Type"),
            field("icao", "ICAO"),
            field("iata", "IATA"),
            field("elevation", "Elevation"),
            field("runways", "Runways"),
            field("longest_runway", "Longest runway"),
            field("country", "Country"),
        ),
        // Public airports are blue and the larger dots, and the private strips and heliports that
        // outnumber them several times over in the US are small and pale.
        listOf(
            Triple(listOf(0, 3, 5, 9), CHART_BLUE, 5),
            Triple(listOf(2, 10, 11, 13), CHART_MAGENTA, 3),
            Triple(listOf(1, 6), CHART_GREEN, 3),
        ).flatMap { (types, fill, radiusPx) ->
          types.map {
            pointLayer(listOf(stringEquals("type", AIRPORT_TYPES[it])), fill, radiusPx)
          }
        } + listOf(pointLayer(listOf(ALWAYS), CHART_GRAY, 2)),
    )

private val NAVAIDS_SCHEMA =
    schema(
        listOf(
            field("type", "Type"),
            field("ident", "Identifier"),
            field("frequency", "Frequency"),
            field("channel", "Channel"),
            field("country", "Country"),
        ),
        listOf(
            listOf(3, 4, 5, 6, 7, 8) to CHART_NAVY,
            listOf(2) to CHART_MAGENTA,
        ).flatMap { (types, fill) ->
          types.map { pointLayer(listOf(stringEquals("type", NAVAID_TYPES[it])), fill) }
        } + listOf(pointLayer(listOf(ALWAYS), CHART_SLATE)),
    )

private val REPORTING_POINTS_SCHEMA =
    schema(
        listOf(
            field("airports", "Airports"),
            field(
                "compulsory",
                "Reporting",
                mapOf("true" to "Compulsory", "false" to "On request")),
            field("country", "Country"),
        ),
        listOf(
            pointLayer(listOf(stringEquals("compulsory", "true")), CHART_NAVY),
            pointLayer(listOf(ALWAYS), CHART_BLUE, 3),
        ),
    )

private val WEATHER_STATIONS_SCHEMA =
    schema(
        listOf(
            field("station", "Station"),
            field("reports", "Reports"),
            field("elevation", "Elevation"),
            field("country", "Country"),
        ),
        listOf(pointLayer(listOf(ALWAYS), CHART_TEAL)),
    )

private val mapper = ObjectMapper()

fun main(args: Array<String>) {
  parseFlags(args)

  var failed = false
  val imports = listOf("openAIP" to ::importOpenAip, "NOAA" to ::importWeatherStations)
  for ((source, import) in imports) {
    try {
      import()
    } catch (e: Exception) {
      // Keep going so one source being down doesn't stop the other from updating.
      logger.error("Failed to import from {}", source, e)
      failed = true
    }
  }
  if (failed) {
    exitProcess(1)
  }
}

private fun importOpenAip() {
  val exports = listOpenAipExports()
  val airports = readOpenAip(exports, "airport")
  replace(airspace(readOpenAip(exports, "airspace")))
  replace(airports(airports))
  replace(navaids(readOpenAip(exports, "navaid")))
  replace(reportingPoints(readOpenAip(exports, "reportingPoint"), airports))
}

// Finds the signed URL of every country's export, keyed by content type and then country. The URL
// is null while an export is pending or after it failed.
private fun listOpenAipExports(): Map<String, Map<String, String?>> {
  val exports = HashMap<String, HashMap<String, String?>>()
  var page = 1
  var pages = 1
  while (page <= pages) {
    val html = String(fetchBytes("${OPENAIP_EXPORTS_URL}${page}"))
    pages =
        checkNotNull(Regex("totalPages:(\\d+)").find(html)) { "openAIP's exports page changed" }
            .groupValues[1]
            .toInt()
    // Items are object literals like {_id:"...",contentType:"airspace",country:"AD",...}. Exports
    // that failed have success:false and no signedUrl.
    for (item in html.split("{_id:").drop(1).map { it.substringBefore("}") }) {
      val fields = Regex("(\\w+):\"([^\"]*)\"").findAll(item).associate {
        it.groupValues[1] to it.groupValues[2]
      }
      val contentType = fields["contentType"] ?: continue
      val country = fields["country"] ?: continue
      exports.getOrPut(contentType) { HashMap() }[country] = fields["signedUrl"]
    }
    page += 1
  }
  logger.info("Found openAIP exports {}", exports.mapValues { it.value.size })
  return exports
}

private fun readOpenAip(exports: Map<String, Map<String, String?>>, contentType: String):
    List<JsonNode> {
  val features = ArrayList<JsonNode>()
  for ((country, url) in checkNotNull(exports[contentType]) { "No ${contentType} exports" }) {
    // Replacing the collection without this country would delete everything we have there, so we
    // fail and wait for the next run.
    checkNotNull(url) { "openAIP's ${contentType} export for ${country} isn't ready" }
    for (line in String(fetchBytes(url)).lineSequence()) {
      if (line.isNotBlank()) {
        features.add(mapper.readTree(line))
      }
    }
    logger.info("Read {} {} features so far, through {}", features.size, contentType, country)
  }
  return features
}

private fun airspace(features: List<JsonNode>): ReplacedCollection {
  val polygons = features.mapNotNull { feature ->
    val properties = feature["properties"]
    val type = properties.number("type")!!.toInt()
    val floor = properties["lowerLimit"]
    val groundReferenced = floor.number("referenceDatum")!!.toInt() == 0
    val icaoClass = ICAO_CLASSES.getOrNull(properties.number("icaoClass")!!.toInt())
    if (SKIPPED_AIRSPACE_TYPES.contains(type)
        || (!groundReferenced && feet(floor) >= UPPER_AIRSPACE_FEET)
        || (icaoClass == "E" && (!groundReferenced || feet(floor) > CLASS_E_FLOOR_FEET))) {
      return@mapNotNull null
    }

    val data =
        hashMapOf(
            "type" to AIRSPACE_TYPES[type],
            "floor" to formatLimit(floor),
            "ceiling" to formatLimit(properties["upperLimit"]),
        )
    properties.text("name")?.let { data["name"] = it }
    icaoClass?.let { data["class"] = it }
    properties.number("activity")
        ?.let { AIRSPACE_ACTIVITIES[it.toInt()] }
        ?.let { data["activity"] = it }
    listOfNotNull(
        "By NOTAM".takeIf { properties["byNotam"]?.asBoolean() == true },
        "On request".takeIf { properties["onRequest"]?.asBoolean() == true },
        "On demand".takeIf { properties["onDemand"]?.asBoolean() == true },
    ).takeIf { it.isNotEmpty() }?.let { data["activation"] = it.joinToString(", ") }
    properties.text("country")?.let { data["country"] = it }
    polygonRow(AIRSPACE_COLLECTION_ID, properties.text("_id")!!, data, feature["geometry"])
  }
  return ReplacedCollection(AIRSPACE_COLLECTION_ID, "openAIP airspace", AIRSPACE_SCHEMA, polygons)
}

private fun airports(features: List<JsonNode>): ReplacedCollection {
  val points = features.map { feature ->
    val properties = feature["properties"]
    val data = hashMapOf("type" to AIRPORT_TYPES[properties.number("type")!!.toInt()])
    properties.text("name")?.let { data["name"] = it }
    properties.text("icaoCode")?.let { data["icao"] = it }
    properties.text("iataCode")?.let { data["iata"] = it }
    properties["elevation"]?.let { data["elevation"] = formatHeight(meters(it)) }
    val runways = properties["runways"]?.toList() ?: listOf()
    runways
        .mapNotNull { it.text("designator") }
        .distinct()
        .takeIf { it.isNotEmpty() }
        ?.let { data["runways"] = it.joinToString(", ") }
    runways
        .mapNotNull { it.path("dimension")["length"] }
        .maxOfOrNull { meters(it) }
        ?.let { data["longest_runway"] = formatHeight(it) }
    properties.text("country")?.let { data["country"] = it }
    pointRow(AIRPORTS_COLLECTION_ID, properties.text("_id")!!, data, latLngOf(feature))
  }
  return ReplacedCollection(
      AIRPORTS_COLLECTION_ID, "openAIP airports", AIRPORTS_SCHEMA, points = points)
}

private fun navaids(features: List<JsonNode>): ReplacedCollection {
  val points = features.map { feature ->
    val properties = feature["properties"]
    val data = hashMapOf("type" to NAVAID_TYPES[properties.number("type")!!.toInt()])
    properties.text("name")?.let { data["name"] = it }
    properties.text("identifier")?.let { data["ident"] = it }
    properties["frequency"]?.let { frequency ->
      // NDBs are in kHz and everything else in MHz.
      val unit =
          when (val code = frequency.number("unit")!!.toInt()) {
            1 -> "kHz"
            2 -> "MHz"
            else -> throw IllegalArgumentException("Unexpected frequency unit ${code}")
          }
      data["frequency"] = "${frequency.text("value")} ${unit}"
    }
    properties.text("channel")?.let { data["channel"] = it }
    properties.text("country")?.let { data["country"] = it }
    pointRow(NAVAIDS_COLLECTION_ID, properties.text("_id")!!, data, latLngOf(feature))
  }
  return ReplacedCollection(
      NAVAIDS_COLLECTION_ID, "openAIP navaids", NAVAIDS_SCHEMA, points = points)
}

// Reporting points are named for where they sit relative to their airports, like "S" or "NE", so
// we name them with their airports too.
private fun reportingPoints(features: List<JsonNode>, airports: List<JsonNode>):
    ReplacedCollection {
  val airportNames =
      airports.associate { it["properties"].text("_id")!! to it["properties"].text("name") }
  val points = features.map { feature ->
    val properties = feature["properties"]
    val served =
        (properties["airports"]?.toList() ?: listOf()).mapNotNull { airportNames[it.asText()] }
    val point = properties.text("name") ?: ""
    val data =
        hashMapOf(
            "name" to if (served.isEmpty()) point else "${point} (${served.joinToString(", ")})",
            "compulsory" to (properties["compulsory"]?.asBoolean() == true).toString(),
        )
    served.takeIf { it.isNotEmpty() }?.let { data["airports"] = it.joinToString(", ") }
    properties.text("country")?.let { data["country"] = it }
    pointRow(REPORTING_POINTS_COLLECTION_ID, properties.text("_id")!!, data, latLngOf(feature))
  }
  return ReplacedCollection(
      REPORTING_POINTS_COLLECTION_ID,
      "openAIP reporting points",
      REPORTING_POINTS_SCHEMA,
      points = points)
}

// Only stations that report METARs, keyed by the ICAO id that the METAR API takes, so that
// clicking one can fetch its latest observation.
private fun importWeatherStations() {
  val points = mapper.readTree(gunzip(fetchBytes(WEATHER_STATIONS_URL))).mapNotNull { station ->
    val id = station.text("icaoId") ?: return@mapNotNull null
    val reports = station["siteType"]?.map { it.asText() } ?: listOf()
    if (!reports.contains("METAR")) {
      return@mapNotNull null
    }

    val data = hashMapOf("station" to id, "reports" to reports.joinToString(", "))
    station.text("site")?.let { data["name"] = it }
    station.number("elev")?.let { data["elevation"] = formatHeight(it) } // in meters
    station.text("country")?.let { data["country"] = it }
    pointRow(
        WEATHER_STATIONS_COLLECTION_ID,
        id,
        data,
        S2LatLng.fromDegrees(station.number("lat")!!, station.number("lon")!!))
  }
  replace(
      ReplacedCollection(
          WEATHER_STATIONS_COLLECTION_ID,
          "NOAA weather stations",
          WEATHER_STATIONS_SCHEMA,
          points = points))
}

private fun latLngOf(feature: JsonNode): S2LatLng {
  val coordinates = feature["geometry"]["coordinates"]
  return S2LatLng.fromDegrees(coordinates[1].asDouble(), coordinates[0].asDouble())
}

// openAIP's spec doesn't list its unit and reference datum codes. Units are 0 for meters, 1 for
// feet, and 6 for flight levels, and datums are 0 for ground, 1 for MSL, and 2 for standard
// pressure. That matches the FAA's limits for every US Class B airspace.
private fun formatLimit(limit: JsonNode): String {
  val value = limit.number("value")!!.toInt()
  val unit = limit.number("unit")!!.toInt()
  val datum = limit.number("referenceDatum")!!.toInt()
  if (unit == 6) {
    return "FL${value}"
  }
  if (value == 0 && datum == 0) {
    return "Surface"
  }
  val reference =
      when (datum) {
        0 -> "AGL"
        1 -> "MSL"
        2 -> "STD"
        else -> throw IllegalArgumentException("Unexpected reference datum ${datum}")
      }
  return "%,d %s %s".format(value, if (unit == 0) "m" else "ft", reference)
}

private fun feet(limit: JsonNode): Double {
  val value = limit.number("value")!!
  return when (val unit = limit.number("unit")!!.toInt()) {
    0 -> value / METERS_PER_FOOT
    1 -> value
    6 -> value * 100
    else -> throw IllegalArgumentException("Unexpected unit ${unit}")
  }
}

private fun meters(length: JsonNode): Double {
  val value = length.number("value")!!
  return when (val unit = length.number("unit")!!.toInt()) {
    0 -> value
    1 -> value * METERS_PER_FOOT
    else -> throw IllegalArgumentException("Unexpected unit ${unit}")
  }
}

private fun formatHeight(meters: Double): String =
    "%,d ft (%,d m)".format(Math.round(meters / METERS_PER_FOOT), Math.round(meters))

private const val METERS_PER_FOOT = 0.3048
