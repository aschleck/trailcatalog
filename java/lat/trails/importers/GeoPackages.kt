package lat.trails.importers

import com.google.common.geometry.S2LatLng
import com.google.common.geometry.S2Polygon
import java.nio.file.Path
import java.util.UUID
import lat.trails.common.assemblePolygon
import mil.nga.sf.MultiPolygon
import org.locationtech.proj4j.CoordinateTransform
import org.locationtech.proj4j.ProjCoordinate
import org.slf4j.LoggerFactory
import org.trailcatalog.flags.FlagSpec
import org.trailcatalog.flags.createNullableFlag

// Shared by the importers that load a GeoPackage of polygons

private val logger = LoggerFactory.getLogger("GeoPackages")

@FlagSpec(name = "source")
val source = createNullableFlag(null as Path?)

/** Converts a GeoPackage geometry, reprojecting it to WGS84 with transform if given. */
fun toS2Polygon(geometry: MultiPolygon, transform: CoordinateTransform?): S2Polygon {
  return assemblePolygon(geometry.polygons.map { polygon ->
    polygon.rings.map { ring ->
      ring.points.map {
        if (transform == null) {
          S2LatLng.fromDegrees(it.y, it.x).toPoint()
        } else {
          val destination = transform.transform(ProjCoordinate(it.x, it.y), ProjCoordinate())
          S2LatLng.fromDegrees(destination.y, destination.x).toPoint()
        }
      }
    }
  })
}

class GeoPackageFeature(
    val data: Map<String, String>,
    val geometry: MultiPolygon,
    val transform: CoordinateTransform? = null,
)

/**
 * Converts the features in parallel and gives each a random id, because these sources don't give
 * their features a stable one. Drops the ones whose geometry fails to build or comes out empty.
 */
fun polygonRows(collection: UUID, features: List<GeoPackageFeature>): List<Row<S2Polygon>> =
    features
        .parallelStream()
        .map {
          val polygon =
              try {
                toS2Polygon(it.geometry, it.transform)
              } catch (e: Exception) {
                logger.warn(
                    "Dropping {} from {} because its geometry fails to build",
                    it.data,
                    collection,
                    e)
                return@map null
              }
          polygonRow(collection, /* key= */ null, it.data, polygon)
        }
        .toList()
        .filterNotNull()
