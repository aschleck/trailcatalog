package lat.trails.importers

import com.fasterxml.jackson.databind.ObjectMapper
import com.google.common.geometry.S1Angle
import com.google.common.geometry.S2CellId
import com.google.common.geometry.S2CellUnion
import com.google.common.geometry.S2LatLng
import com.google.common.geometry.S2Loop
import com.google.common.geometry.S2Polygon
import com.google.common.geometry.S2PolygonBuilder
import com.google.common.geometry.S2Projections
import com.google.common.geometry.S2RegionCoverer
import java.io.ByteArrayOutputStream
import java.nio.file.Path
import java.util.Comparator
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import lat.trails.common.COLLECTION_COVERING_MAX_LEVEL
import lat.trails.common.FEATURE_COVERING_MAX_LEVEL
import lat.trails.common.createConnection
import mil.nga.geopackage.GeoPackageManager
import mil.nga.sf.MultiPolygon
import org.apache.commons.text.StringEscapeUtils
import org.locationtech.proj4j.CRSFactory
import org.locationtech.proj4j.CoordinateReferenceSystem
import org.locationtech.proj4j.CoordinateTransform
import org.locationtech.proj4j.CoordinateTransformFactory
import org.locationtech.proj4j.ProjCoordinate
import org.slf4j.LoggerFactory
import org.trailcatalog.common.DelegatingEncodedOutputStream
import org.trailcatalog.flags.FlagSpec
import org.trailcatalog.flags.createNullableFlag
import org.trailcatalog.flags.parseFlags
import org.trailcatalog.importers.basemap.StringifyingInputStream
import org.trailcatalog.importers.basemap.appendByteArray
import org.trailcatalog.importers.basemap.copyStreamToPg
import org.trailcatalog.s2.polygonToCell

private val logger = LoggerFactory.getLogger("PublicAccess")

@FlagSpec(name = "source")
private val source = createNullableFlag(null as Path?)

data class Feature(val data: Map<String, String>, val covering: S2CellUnion, val polygon: S2Polygon)

fun main(args: Array<String>) {
  parseFlags(args)

  val manager = GeoPackageManager.open(false, source.value!!.toFile())

  val ignoreCategory = hashSetOf("Easement")
  val ignoreAccess = hashSetOf("UK", "XA")
  val ignoreOwners =
      hashSetOf(
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
  for (table in listOf("PADUS3_0Combined_DOD_TRIB_Fee_Designation_Easement", "PADUS3_0Marine")) {
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
            polygons.add(Feature(data, covering, polygon))
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
    val covering = HashSet<S2CellId>()
    for (feature in polygons) {
      for (cell in feature.covering) {
        covering.add(cell.parent(COLLECTION_COVERING_MAX_LEVEL.coerceAtMost(cell.level())))
      }
    }
    dumpPolygons(ArrayList(covering), polygons)
  }
}

private fun toS2Polygon(geometry: MultiPolygon, transform: CoordinateTransform): S2Polygon {
  val builder = S2PolygonBuilder(S2PolygonBuilder.Options.DIRECTED_UNION)
  for (polygon in geometry.polygons) {
    var exterior = true
    for (ring in polygon.rings) {
      val loop =
          // The first and last points are the same
          S2Loop(ring.points.drop(1).map {
            val source = ProjCoordinate(it.x, it.y)
            val destination = transform.transform(source, ProjCoordinate())
            S2LatLng.fromDegrees(destination.y, destination.x).toPoint()
          })
      loop.normalize()
      if (!exterior) {
        loop.invert()
      } else {
        exterior = false
      }
      builder.addLoop(loop)
    }
  }

  val snapped = S2Polygon()
  snapped.initToSimplified(
      builder.assemblePolygon(),
      S1Angle.radians(S2Projections.PROJ.maxDiag.getValue(21) / 2.0 + 1e-15),
      /* snapToCellCenters= */ true)
  return snapped
}

private fun dumpPolygons(covering: MutableList<S2CellId>, polygons: List<Feature>) {
  createConnection().use { hikari ->
    val collection =
        hikari.connection
            .prepareStatement(
                "INSERT INTO collections (id, creator, name, covering) "
                    + "VALUES (gen_random_uuid(), ?, ?, ?) "
                    + "RETURNING id")
            .apply {
              setObject(1, UUID.fromString("00000000-0000-0000-0000-000000000000"))
              setString(2, "Public Land")
              setBytes(
                  3,
                  ByteArrayOutputStream().also {
                    DelegatingEncodedOutputStream(it).use {
                      covering.sortWith(Comparator.naturalOrder())
                      it.writeVarInt(1)
                      it.writeVarInt(covering.size)
                      for (cell in covering) {
                        it.writeLong(cell.id())
                      }
                    }
                  }.toByteArray())
            }
            .executeQuery()
            .use {
              it.next()
              it.getString(1)
            }

    val mapper = ObjectMapper()
    val stream = StringifyingInputStream(polygons.iterator()) { feature, csv ->
      // id,collection,cell,covering,data,s2_polygon
      csv.append(UUID.randomUUID())
      csv.append(",")
      csv.append(collection)
      csv.append(",")
      csv.append(polygonToCell(feature.polygon).id())
      csv.append(",")
      appendByteArray(ByteArrayOutputStream().also {
        feature.covering.encode(it)
      }.toByteArray(), csv)
      csv.append(",")
      csv.append(StringEscapeUtils.escapeCsv(mapper.writeValueAsString(feature.data)))
      csv.append(",")
      appendByteArray(ByteArrayOutputStream().also {
        feature.polygon.encode(it)
      }.toByteArray(), csv)
      csv.append("\n")
    }
    copyStreamToPg("polygons", stream, hikari)
  }
}
