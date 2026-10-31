package lat.trails.importers

import lat.trails.wire.JAPANESE_NATIONAL_PARKS_COLLECTION_ID as COLLECTION_ID
import mil.nga.geopackage.GeoPackageManager
import mil.nga.sf.MultiPolygon
import mil.nga.sf.Polygon
import org.slf4j.LoggerFactory
import org.trailcatalog.flags.parseFlags

private val logger = LoggerFactory.getLogger("JapanNationalParks")

// Leaves out 区分未定, the zone of the four polygons not yet assigned one
private val ZONES =
    mapOf(
        "特別保護地区" to "Special protection zone",
        "第1種特別地域" to "Class I special zone",
        "第2種特別地域" to "Class II special zone",
        "第3種特別地域" to "Class III special zone",
        "普通地域" to "Ordinary zone",
        "海域公園地区" to "Marine park zone",
    )

// The zones in the European designated areas' IUCN colors by how strictly they're regulated, see
// EuropeanDesignatedAreas.kt
private val SCHEMA =
    schema(
        listOf(field("zone", "Zone")),
        listOf(
            "Special protection zone" to "#00A04088",
            "Class I special zone" to "#00A04088",
            "Class II special zone" to "#40C0A088",
            "Class III special zone" to "#40C0A088",
            "Marine park zone" to "#40C0A088",
        ).map { (zone, fill) ->
          polygonLayer(listOf(stringEquals("zone", zone)), fill)
        } + listOf(polygonLayer(listOf(ALWAYS), "#A0C04088")),
    )

// Imports the Ministry of the Environment's national park zones, converted from the JGD2000
// shapefile to a GeoPackage. JGD2000 is within a meter of WGS84, so we don't reproject.
// https://www.biodic.go.jp/nps_nwp_nca_cz.html
fun main(args: Array<String>) {
  parseFlags(args)

  val geoPackage = GeoPackageManager.open(false, source.value!!.toFile())
  val features = ArrayList<GeoPackageFeature>()
  for (row in geoPackage.getFeatureDao("nps").queryForAll()) {
    val data = HashMap<String, String>()
    data["name"] = "${row.getValue("NAME")}国立公園"
    ZONES[row.getValue("ZONE") as String?]?.let { data["zone"] = it }
    val multiPolygon =
        when (val geometry = row.geometry.geometry) {
          is MultiPolygon -> geometry
          is Polygon -> MultiPolygon(listOf(geometry))
          else -> throw IllegalStateException("Unexpected geometry ${geometry.geometryType}")
        }
    features.add(GeoPackageFeature(data, multiPolygon))
  }

  val polygons = polygonRows(COLLECTION_ID, features)
  logger.info("Converted {} zones", polygons.size)
  replace(
      ReplacedCollection(
          COLLECTION_ID, "Japanese national parks 2025", SCHEMA, polygons = polygons))
}
