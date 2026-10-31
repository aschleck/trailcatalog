package lat.trails.importers

import com.google.common.geometry.S2CellId
import com.google.common.geometry.S2CellUnion
import com.google.common.geometry.S2Earth
import com.google.common.geometry.S2LatLng
import com.google.common.geometry.S2Polygon
import com.google.common.geometry.S2RegionCoverer
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import lat.trails.common.FEATURE_COVERING_MAX_LEVEL
import lat.trails.wire.PUBLIC_LAND_COLLECTION_ID as COLLECTION_ID
import mil.nga.geopackage.GeoPackageManager
import mil.nga.sf.MultiPolygon
import org.locationtech.proj4j.CRSFactory
import org.locationtech.proj4j.CoordinateReferenceSystem
import org.locationtech.proj4j.CoordinateTransformFactory
import org.slf4j.LoggerFactory
import org.trailcatalog.flags.parseFlags
import org.trailcatalog.s2.polygonToCell

private val logger = LoggerFactory.getLogger("PublicAccess")

private data class Feature(
    val data: Map<String, String>,
    val cell: S2CellId,
    val covering: S2CellUnion,
    val polygon: S2Polygon,
)

// owner is a label and access is PAD-US's code
private val SCHEMA =
    schema(
        listOf(
            field("owner", "Owner"),
            field("access", "Access", mapOf("OA" to "Open", "RA" to "Restricted")),
        ),
        listOf(
            polygonLayer(listOf(stringEquals("owner", "BLM/BR")), "#FFFF0088"),
            polygonLayer(listOf(stringEquals("owner", "NPS")), "#00FF0088"),
            polygonLayer(listOf(stringEquals("owner", "USFS")), "#0000FF88"),
            polygonLayer(listOf(ALWAYS), "#FF000088"),
        ),
    )

fun main(args: Array<String>) {
  parseFlags(args)

  val manager = GeoPackageManager.open(false, source.value!!.toFile())

  val ignoreCategory = hashSetOf("Easement", "Proclamation")
  val ignoreAccess = hashSetOf("UK", "XA")
  val ignoreOwners =
      hashSetOf(
          "BOEM", // Bureau of Ocean Energy Management: offshore leasing, not recreation land
          "DESG", // Designations, not actual usage
          "JNT", // Unclear owner
          "PVT", // Not public land
          "NGO", // Not public land
          "OTHF", // Other federal: includes weird things that don't make sense
          "OTHS", // Other state: includes weird things that don't make sense
          "REG", // Regional districts, like golf courses
          "RWD", // Regional Water Districts overstate their control
          "TVA", // Tennessee Valley Authority
          "UNK", // Cool category but unclear owner
      )
  val ownerToLabel =
        hashMapOf(
            // Federal
            "BLM" to "BLM/BR",
            "DOD" to "DOD",
            "DOE" to "DOE",
            "FWS" to "FWS",
            "NPS" to "NPS",
            "NRCS" to "USDA",
            "USACE" to "DOD",
            "USBR" to "BLM/BR",
            "USFS" to "USFS",

            // State
            "OTHS" to "State",
            "SDC" to "State",
            "SDNR" to "State",
            "SDOL" to "State",
            "SFW" to "State",
            "SLB" to "State",
            "SPR" to "State",
            "GU" to "State", // Guam
            "PW" to "State", // Palau
            "VI" to "State", // U.S. Virgin Islands

            // Local
            "CITY" to "Local",
            "CNTY" to "Local",
            "LOC" to "Local",
            "OTHR" to "Local",
            "UNKL" to "Local",

            // Tribal
            "TRIB" to "Tribal",
        )

  val executors = Executors.newFixedThreadPool(8)

  val factory = CRSFactory()
  val projections = HashMap<Int, CoordinateReferenceSystem>()
  projections[102039] =
      factory.createFromParameters(
          "ESRI:102039",
          "+proj=aea +lat_0=23 +lon_0=-96 +lat_1=29.5 +lat_2=45.5 +x_0=0 +y_0=0 +datum=NAD83 +units=m +no_defs")
  val wgs84 =
      factory.createFromParameters(
          "WGS84", "+title=long/lat:WGS84 +proj=longlat +datum=WGS84 +units=degrees")

  val polygons = ArrayList<Feature>()
  val coverer = S2RegionCoverer.builder().setMaxLevel(FEATURE_COVERING_MAX_LEVEL).build()
  for (table in listOf("PADUS4_1Combined_Proclamation_Marine_Fee_Designation_Easement")) {
    for (result in manager.getFeatureDao(table).queryForAll()) {
      if (ignoreCategory.contains(result.getValue("Category"))) {
        continue
      }

      if (ignoreAccess.contains(result.getValue("Pub_Access"))) {
        continue
      }

      val shortOwner = result.getValue("Own_Name").toString()
      if (ignoreOwners.contains(shortOwner)) {
        continue
      }

      val access = result.getValue("Pub_Access").toString()
      val owner = ownerToLabel[shortOwner]
      if (owner == null) {
        logger.warn("${shortOwner}: ${result.id}")
        continue
      }

      val name = result.getValue("Unit_Nm").toString()
      val data =
          hashMapOf(
              "access" to access,
              "name" to name,
              "owner" to owner,
          )

      val transform =
          CoordinateTransformFactory().createTransform(projections[result.geometry.srsId], wgs84)
      val geometry = result.geometry.geometry
      if (geometry is MultiPolygon) {
        executors.submit {
          val polygon = toS2Polygon(geometry, transform)
          val covering = coverer.getCovering(polygon)
          synchronized (polygons) {
            polygons.add(Feature(data, polygonToCell(polygon), covering, polygon))
          }
        }
      } else {
        logger.warn("Unexpected geometry type {}", geometry.javaClass.name)
      }
    }
  }

  executors.shutdown()
  executors.awaitTermination(1, TimeUnit.HOURS)

  // Does this work...? Too bad I gave away Java Concurrency in Practice...
  synchronized (polygons) {
    replace(
        ReplacedCollection(
            COLLECTION_ID,
            "PAD-US 4.1",
            SCHEMA,
            polygons = deduplicate(polygons).map { polygonRow(it.data, it.polygon) }))
  }
}

// Two records are the same piece of land if they agree on the unit's name, owner and access and
// enclose the same area around the same centroid. Both conditions together make a false match
// between genuinely distinct units very unlikely. 100 m is far below the spacing of units that
// share all three fields and far above the ~4 m grid toS2Polygon snaps vertices to.
private val DUPLICATE_CENTROID_DISTANCE = S2Earth.metersToAngle(100.0)

private fun deduplicate(polygons: List<Feature>): List<Feature> {
  val result = ArrayList<Feature>()
  for ((_, group) in polygons.groupBy { it.data }) {
    val kept = ArrayList<Feature>()
    for (feature in group) {
      if (kept.none { it.polygon.duplicates(feature.polygon) }) {
        kept.add(feature)
      }
    }
    result.addAll(kept)
  }
  logger.info("Dropped {} duplicate records, kept {}", polygons.size - result.size, result.size)
  return result
}

private fun S2Polygon.duplicates(other: S2Polygon): Boolean =
    Math.abs(area - other.area) <= 0.01 * area
        && S2LatLng(centroid).getDistance(S2LatLng(other.centroid)) < DUPLICATE_CENTROID_DISTANCE
