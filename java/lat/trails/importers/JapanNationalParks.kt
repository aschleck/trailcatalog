package lat.trails.importers

import com.google.common.geometry.S2Polygon
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
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

// Imports the Ministry of the Environment's national park zones, converted from the JGD2000
// shapefile to a GeoPackage. JGD2000 is within a meter of WGS84, so we don't reproject.
// https://www.biodic.go.jp/nps_nwp_nca_cz.html
fun main(args: Array<String>) {
  parseFlags(args)

  val geoPackage = GeoPackageManager.open(false, source.value!!.toFile())
  val executors = Executors.newFixedThreadPool(8)
  val polygons = ArrayList<Pair<Map<String, String>, S2Polygon>>()
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
    executors.submit {
      val polygon = toS2Polygon(multiPolygon, /* transform= */ null)
      synchronized (polygons) {
        polygons.add(data to polygon)
      }
    }
  }

  executors.shutdown()
  executors.awaitTermination(1, TimeUnit.HOURS)
  logger.info("Converted {} zones", polygons.size)

  synchronized (polygons) {
    dumpPolygons("Japanese national parks 2025", polygons)
  }
}
