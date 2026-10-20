package lat.trails.importers

import com.fasterxml.jackson.core.JsonToken
import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.google.common.geometry.S2Polygon
import java.io.ByteArrayInputStream
import java.util.concurrent.Executors
import java.util.concurrent.Future
import java.util.zip.ZipInputStream
import lat.trails.common.TIME_ZONES_COLLECTION_ID
import org.slf4j.LoggerFactory
import org.trailcatalog.flags.parseFlags

private val logger = LoggerFactory.getLogger("TimeZones")

private const val RELEASES_URL =
    "https://api.github.com/repos/evansiroky/timezone-boundary-builder/releases/latest"

// The 1970 variant merges zones that have agreed since 1970, the same cutoff tzdb uses to decide
// which zones are canonical, so every id it names is one a browser knows. The ocean zones mean
// every point on Earth is in some zone.
private const val ASSET = "timezones-with-oceans-1970.geojson.zip"

private val SCHEMA =
    schema(listOf(field("zone", "Time zone")), listOf(polygonLayer(listOf(ALWAYS), "#8080C040")))

private val mapper = ObjectMapper()

// Imports the time zone boundaries that timezone-boundary-builder derives from OSM.
// https://github.com/evansiroky/timezone-boundary-builder
fun main(args: Array<String>) {
  parseFlags(args)

  val release = mapper.readTree(fetchBytes(RELEASES_URL))
  val url =
      release["assets"].single { it["name"].asText() == ASSET }["browser_download_url"].asText()
  logger.info("Fetching {} from release {}", ASSET, release["tag_name"].asText())

  val executors = Executors.newFixedThreadPool(8)
  val rows = ArrayList<Future<Row<S2Polygon>?>>()
  ZipInputStream(ByteArrayInputStream(fetchBytes(url))).use { zip ->
    while (!checkNotNull(zip.nextEntry) { "${ASSET} has no GeoJSON" }.name.endsWith(".json")) {}

    // The file is a few hundred MB of coordinates, so we read it a feature at a time rather than
    // as one tree.
    mapper.factory.createParser(zip).use { parser ->
      while (parser.nextToken() != null) {
        if (parser.currentToken != JsonToken.FIELD_NAME || parser.currentName() != "features") {
          continue
        }
        check(parser.nextToken() == JsonToken.START_ARRAY)
        while (parser.nextToken() == JsonToken.START_OBJECT) {
          val feature = parser.readValueAsTree<JsonNode>()
          val zone = feature["properties"]["tzid"].asText()
          rows.add(
              executors.submit<Row<S2Polygon>?> {
                polygonRow(
                    TIME_ZONES_COLLECTION_ID, zone, mapOf("zone" to zone), feature["geometry"])
              })
        }
      }
    }
  }
  val polygons = rows.mapNotNull { it.get() }
  executors.shutdown()
  check(polygons.isNotEmpty()) { "${ASSET} has no zones" }

  replace(ReplacedCollection(TIME_ZONES_COLLECTION_ID, "Time zones", SCHEMA, polygons))
}
