package lat.trails.importers

import com.google.common.geometry.S2LatLng
import com.google.common.geometry.S2Polygon
import java.nio.file.Path
import java.util.UUID
import lat.trails.common.assemblePolygon
import mil.nga.sf.MultiPolygon
import org.locationtech.proj4j.CoordinateTransform
import org.locationtech.proj4j.ProjCoordinate
import org.trailcatalog.flags.FlagSpec
import org.trailcatalog.flags.createNullableFlag
import org.trailcatalog.s2.polygonToCell

// Shared by the importers that load a GeoPackage of polygons

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

/** Makes a row with a new id, for sources that don't give their features a stable one. */
fun polygonRow(data: Map<String, String>, polygon: S2Polygon): Row<S2Polygon> =
    Row(UUID.randomUUID(), data, polygonToCell(polygon), polygon.rectBound, polygon)
