package lat.trails.importers

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.google.common.geometry.S2LatLng
import java.net.URLEncoder
import java.nio.charset.StandardCharsets
import java.util.UUID
import org.slf4j.LoggerFactory
import org.trailcatalog.flags.parseFlags

private val logger = LoggerFactory.getLogger("UsfsMvum")

// Keep in sync with layer_catalog.ts
private val COLLECTION_ID = UUID.fromString("0dc37e1d-bcac-4720-9a23-1cc0683e7090")

// The Forest Service's Motor Vehicle Use Maps, with roads in layer 1 and trails in layer 2
// https://data.fs.usda.gov/geodata/edw/datasets.php
private const val SERVICE_URL =
    "https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_MVUM_01/MapServer"

// the service's maxRecordCount
private const val PAGE_SIZE = 2000

private class Vehicle(val flag: String, val dates: String, val id: String, val label: String)

// Each class is "open" in its flag column when the route is designated for it, and the dates column
// says when.
private val VEHICLES =
    listOf(
        Vehicle(
            "passengervehicle",
            "passengervehicle_datesopen",
            "passenger_vehicles",
            "Passenger vehicles"),
        Vehicle(
            "highclearancevehicle",
            "highclearancevehicle_datesopen",
            "high_clearance_vehicles",
            "High clearance vehicles"),
        Vehicle("truck", "truck_datesopen", "trucks", "Trucks"),
        Vehicle("bus", "bus_datesopen", "buses", "Buses"),
        Vehicle("motorhome", "motorhome_datesopen", "motorhomes", "Motorhomes"),
        Vehicle(
            "fourwd_gt50inches",
            "fourwd_gt50_datesopen",
            "four_wd_over_50_inches",
            "4WD over 50\""),
        Vehicle(
            "twowd_gt50inches", "twowd_gt50_datesopen", "two_wd_over_50_inches", "2WD over 50\""),
        Vehicle(
            "tracked_ohv_gt50inches",
            "tracked_ohv_gt50_datesopen",
            "tracked_ohvs_over_50_inches",
            "Tracked OHVs over 50\""),
        Vehicle(
            "other_ohv_gt50inches",
            "other_ohv_gt50_datesopen",
            "other_ohvs_over_50_inches",
            "Other OHVs over 50\""),
        Vehicle("atv", "atv_datesopen", "atvs", "ATVs"),
        Vehicle("motorcycle", "motorcycle_datesopen", "motorcycles", "Motorcycles"),
        Vehicle(
            "otherwheeled_ohv",
            "otherwheeled_ohv_datesopen",
            "other_wheeled_ohvs",
            "Other wheeled OHVs"),
        Vehicle(
            "tracked_ohv_lt50inches",
            "tracked_ohv_lt50_datesopen",
            "tracked_ohvs_50_inches_or_less",
            "Tracked OHVs 50\" or less"),
        Vehicle(
            "other_ohv_lt50inches",
            "other_ohv_lt50_datesopen",
            "other_ohvs_50_inches_or_less",
            "Other OHVs 50\" or less"),
        Vehicle("e_bike_class1", "e_bike_class1_dur", "class_1_e_bikes", "Class 1 e-bikes"),
        Vehicle("e_bike_class2", "e_bike_class2_dur", "class_2_e_bikes", "Class 2 e-bikes"),
        Vehicle("e_bike_class3", "e_bike_class3_dur", "class_3_e_bikes", "Class 3 e-bikes"),
    )

private const val ALL_VEHICLES = "All vehicles"
private const val HIGHWAY_LEGAL = "Highway legal vehicles only"
private const val NARROW_VEHICLES = "Vehicles 50\" or less wide"
private const val WHEELED_OHVS = "Wheeled OHVs under 50\""
private const val MOTORCYCLES = "Motorcycles"
private const val SPECIAL = "Special designation"

private const val YEARLONG = "Yearlong"
private const val SEASONAL = "Seasonal"

// The map's legend by its symbol code
private val SYMBOLS =
    mapOf(
        "1" to (ALL_VEHICLES to YEARLONG),
        "2" to (ALL_VEHICLES to SEASONAL),
        "3" to (HIGHWAY_LEGAL to YEARLONG),
        "4" to (HIGHWAY_LEGAL to SEASONAL),
        "5" to (ALL_VEHICLES to YEARLONG),
        "6" to (ALL_VEHICLES to SEASONAL),
        "7" to (NARROW_VEHICLES to YEARLONG),
        "8" to (NARROW_VEHICLES to SEASONAL),
        "9" to (MOTORCYCLES to YEARLONG),
        "10" to (MOTORCYCLES to SEASONAL),
        "11" to (SPECIAL to YEARLONG),
        "12" to (SPECIAL to SEASONAL),
        "16" to (WHEELED_OHVS to YEARLONG),
        "17" to (WHEELED_OHVS to SEASONAL),
    )

private class Symbol(
    val stroke: String, val casing: String, val widthPx: Double, val pattern: String)

private const val BLACK = "#000000"
private const val WHITE = "#FFFFFF"
private const val SEASONAL_HALO = "#CCCCCC"

// The printed maps' legend, by route type and who may drive it
private val LEGEND =
    listOf(
        Triple("Road", ALL_VEHICLES, Symbol(WHITE, BLACK, 3.0, "alternating")),
        Triple("Road", HIGHWAY_LEGAL, Symbol(WHITE, BLACK, 1.5, "solid")),
        Triple("Road", SPECIAL, Symbol(WHITE, BLACK, 1.5, "short_dashed")),
        Triple("Trail", ALL_VEHICLES, Symbol(WHITE, BLACK, 2.0, "dashed")),
        Triple("Trail", NARROW_VEHICLES, Symbol(BLACK, BLACK, 1.5, "dashed")),
        Triple("Trail", WHEELED_OHVS, Symbol(BLACK, BLACK, 0.5, "fine_dotted")),
        Triple("Trail", MOTORCYCLES, Symbol(BLACK, BLACK, 1.0, "dotted")),
        Triple("Trail", SPECIAL, Symbol(WHITE, BLACK, 1.5, "short_dashed")),
    )

private val SCHEMA =
    schema(
        listOf(
            field("name", "Name"),
            field("number", "Number"),
            field("type", "Type"),
            field("access", "Open to"),
            field("season", "Season"),
            field("surface", "Surface"),
            field("trail_class", "Trail class"),
        ) +
            VEHICLES.map { field(it.id, it.label) } +
            listOf(field("forest", "Forest"), field("district", "District")),
        LEGEND.flatMap { (type, access, symbol) ->
          val route = listOf(stringEquals("type", type), stringEquals("access", access))
          listOf(
              route + stringEquals("season", SEASONAL) to SEASONAL_HALO,
              route to null,
          ).map { (filters, halo) ->
            lineLayer(
                filters,
                symbol.stroke,
                symbol.widthPx,
                symbol.pattern,
                casing = symbol.casing,
                halo = halo,
                labelKey = "number")
          }
        } + listOf(lineLayer(listOf(ALWAYS), BLACK, 1.0, "solid", labelKey = "number")),
    )

// Ranges are MM/DD-MM/DD, several to a field separated by spaces, but some drop a leading zero or
// put spaces around the dash.
private val DATE_RANGE = Regex("(\\d{1,2})/(\\d{1,2})/?\\s*-\\s*(\\d{1,2})/(\\d{1,2})")

private val mapper = ObjectMapper()

fun main(args: Array<String>) {
  parseFlags(args)

  val lines =
      fetchLayer(/* layer= */ 1, "Road", "routestatus", "sbs_symbol_name") +
          fetchLayer(/* layer= */ 2, "Trail", "trailstatus", "trailclass")
  replace(ReplacedCollection(COLLECTION_ID, "USFS motor vehicle use", SCHEMA, lines = lines))
}

// Roads and trails name their status column differently, and detailField is the surface for roads
// and the trail class for trails.
private fun fetchLayer(layer: Int, type: String, statusField: String, detailField: String):
    List<Row<ByteArray>> {
  val fields =
      listOf(
          "objectid",
          "globalid",
          "id",
          "name",
          "symbol",
          statusField,
          "forestname",
          "districtname",
          detailField) + VEHICLES.flatMap { listOf(it.flag, it.dates) }
  val rows = ArrayList<Row<ByteArray>>()
  var after = 0L
  while (true) {
    val query =
        mapOf(
            "where" to "objectid > ${after}",
            "outFields" to fields.joinToString(","),
            "orderByFields" to "objectid",
            "resultRecordCount" to PAGE_SIZE.toString(),
            "outSR" to "4326",
            // about 10 cm
            "geometryPrecision" to "6",
            "f" to "geojson",
        )
    val url =
        "${SERVICE_URL}/${layer}/query?" +
            query.entries.joinToString("&") { (key, value) ->
              "${key}=${URLEncoder.encode(value, StandardCharsets.UTF_8)}"
            }
    val response = mapper.readTree(fetchBytes(url))
    val features = checkNotNull(response["features"]) { "MVUM answered ${response}" }.toList()
    if (features.isEmpty()) {
      break
    }
    for (feature in features) {
      rows.addAll(toLines(feature, type, statusField, detailField))
    }
    after = features.last()["properties"]["objectid"].asLong()
    logger.info("Read {} {} lines so far", rows.size, type)
  }
  return rows
}

private fun toLines(feature: JsonNode, type: String, statusField: String, detailField: String):
    List<Row<ByteArray>> {
  val properties = feature["properties"]
  // A decommissioned route is closed, whatever its symbol says.
  if (properties.text(statusField)?.startsWith("DE") == true) {
    return listOf()
  }
  val geometry = feature["geometry"]?.takeUnless { it.isNull } ?: return listOf()

  val data = hashMapOf("type" to type)
  properties.text("name")?.let { data["name"] = it }
  properties.text("id")?.let { data["number"] = it }
  SYMBOLS[properties.text("symbol")]?.let { (access, season) ->
    data["access"] = access
    data["season"] = season
  }
  properties.text(detailField)?.let { data[if (type == "Road") "surface" else "trail_class"] = it }
  for (vehicle in VEHICLES) {
    if (properties.text(vehicle.flag).equals("open", ignoreCase = true)) {
      data[vehicle.id] = normalizeDates(properties.text(vehicle.dates)) ?: "Open, dates not listed"
    }
  }
  properties.text("forestname")?.let { data["forest"] = it }
  properties.text("districtname")?.let { data["district"] = it }

  val parts =
      when (val geometryType = geometry["type"].asText()) {
        "LineString" -> listOf(geometry["coordinates"])
        "MultiLineString" -> geometry["coordinates"].toList()
        else -> throw IllegalArgumentException("Unexpected geometry type ${geometryType}")
      }
  val key = properties.text("globalid")!!
  return parts.mapIndexedNotNull { i, part ->
    val latLngs = part.map { S2LatLng.fromDegrees(it[1].asDouble(), it[0].asDouble()) }
    if (latLngs.size < 2) null else lineRow(COLLECTION_ID, "${key}/${i}", data, latLngs)
  }
}

private fun normalizeDates(raw: String?): String? =
    DATE_RANGE.findAll(raw ?: "")
        .map { match ->
          val (fromMonth, fromDay, toMonth, toDay) = match.destructured.toList().map { it.toInt() }
          "%02d/%02d-%02d/%02d".format(fromMonth, fromDay, toMonth, toDay)
        }
        .joinToString(", ")
        .takeIf { it.isNotEmpty() }
