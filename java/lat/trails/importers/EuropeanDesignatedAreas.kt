package lat.trails.importers

import com.google.common.geometry.S2Polygon
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import mil.nga.geopackage.GeoPackageManager
import mil.nga.sf.MultiPolygon
import mil.nga.sf.Polygon
import org.slf4j.LoggerFactory
import org.trailcatalog.flags.parseFlags

private val logger = LoggerFactory.getLogger("EuropeanDesignatedAreas")

// IUCN categories, which the EEA reports as notApplicable, notAssigned, or notReported otherwise
private val IUCN_CATEGORIES = setOf("Ia", "Ib", "II", "III", "IV", "V", "VI")

// Imports the EEA's Nationally designated areas, the European counterpart to PAD-US, from the
// EPSG:4326 GeoPackage.
// https://doi.org/10.2909/028003e7-7585-4d69-92fc-7f81e0cc2340
fun main(args: Array<String>) {
  parseFlags(args)

  val geoPackage = GeoPackageManager.open(false, source.value!!.toFile())

  // code,name
  val designations = HashMap<String, String>()
  for (row in geoPackage.getAttributesDao("DesignationType").queryForAll()) {
    val name = row.getValue("designationTypeNameEnglish") ?: row.getValue("designationTypeName")
    designations[row.getValue("designationTypeCode") as String] = name as String
  }

  // Sites and designations are one to one, joined on natDAId
  val areas = HashMap<Long, Map<String, String>>()
  for (row in geoPackage.getAttributesDao("DesignatedArea").queryForAll()) {
    val data = HashMap<String, String>()
    (row.getValue("siteName") as String?)?.let { data["name"] = it }
    designations[row.getValue("designationTypeCode") as String?]?.let { data["designation"] = it }
    (row.getValue("iucnCategory") as String?)
        ?.takeIf { IUCN_CATEGORIES.contains(it) }
        ?.let { data["iucn"] = it }
    (row.getValue("legalFoundationDate") as Number?)?.let { data["designated"] = it.toString() }
    (row.getValue("countryCode") as String?)?.let { data["country"] = it }
    areas[(row.getValue("natDAId") as Number).toLong()] = data
  }

  val executors = Executors.newFixedThreadPool(8)
  val polygons = ArrayList<Pair<Map<String, String>, S2Polygon>>()
  var points = 0
  for (row in geoPackage.getFeatureDao("ProtectedSite").queryForAll()) {
    val data = areas[(row.getValue("natDAId") as Number).toLong()]!!
    val multiPolygon =
        when (val geometry = row.geometry.geometry) {
          is MultiPolygon -> geometry
          is Polygon -> MultiPolygon(listOf(geometry))
          else -> {
            // Sites the EEA only has a center for
            points += 1
            continue
          }
        }
    executors.submit {
      val polygon = toS2Polygon(multiPolygon, /* transform= */ null)
      synchronized (polygons) {
        polygons.add(data to polygon)
      }
    }
  }

  executors.shutdown()
  executors.awaitTermination(1, TimeUnit.HOURS)
  logger.info("Skipped {} sites without boundaries", points)

  synchronized (polygons) {
    dumpPolygons("Nationally designated areas 2026", polygons)
  }
}
