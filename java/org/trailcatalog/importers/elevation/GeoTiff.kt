package org.trailcatalog.importers.elevation

import com.google.common.geometry.S2LatLng
import org.locationtech.proj4j.ProjCoordinate

data class XyPair(val x: Double, val y: Double)

data class Origin(val modelPosition: XyPair, val rasterScale: XyPair)

// https://docs.opengeospatial.org/is/19-008r4/19-008r4.html#_requirements_class_geodeticcrsgeokey

enum class GeoTiffTagType(val id: Short) {
  // http://geotiff.maptools.org/spec/geotiff2.7.html
  GTModelTypeGeoKey(1024),
  GTRasterTypeGeoKey(1025),
  GeodeticCRSGeoKey(2048),
  GeogAngularUnitsGeoKey(2054),
  ProjectedCSTypeGeoKey(3072),
  ProjLinearUnitsGeoKey(3076),
}

enum class GeoTiffAngularUnits(val id: Short) {
  // http://geotiff.maptools.org/spec/geotiff6.html#6.3.1.4
  AngularDegree(9102),
}

enum class GeoTiffLinearUnits(val id: Short) {
  // http://geotiff.maptools.org/spec/geotiff6.html#6.3.1.3
  LinearMeter(9001),
}

enum class GeoTiffModelType(val id: Short) {
  // http://geotiff.maptools.org/spec/geotiff6.html#6.3.1.1
  ModelTypeProjected(1),
  ModelTypeGeographic(2),
  ModelTypeGeocentric(3),
}

enum class GeoTiffRasterSpace(val id: Short) {
  // http://geotiff.maptools.org/spec/geotiff6.html#6.3.1.2
  RasterPixelIsArea(1),
  RasterPixelIsPoint(2),
}

fun ProjCoordinate.degreesToS2LatLng(): S2LatLng {
  return S2LatLng.fromDegrees(y, x)
}

fun S2LatLng.toProjCoordinateDegrees(): ProjCoordinate {
  return ProjCoordinate().also {
    it.x = lngDegrees()
    it.y = latDegrees()
  }
}
