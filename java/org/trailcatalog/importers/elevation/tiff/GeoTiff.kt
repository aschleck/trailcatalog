package org.trailcatalog.importers.elevation.tiff

// https://docs.opengeospatial.org/is/19-008r4/19-008r4.html#_requirements_class_geodeticcrsgeokey

enum class GeoTiffTagType(val id: UShort) {
  // http://geotiff.maptools.org/spec/geotiff2.7.html
  GTModelTypeGeoKey(1024.toUShort()),
  GTRasterTypeGeoKey(1025.toUShort()),
  GeodeticCRSGeoKey(2048.toUShort()),
  GeogAngularUnitsGeoKey(2054.toUShort()),
  ProjectedCSTypeGeoKey(3072.toUShort()),
  ProjLinearUnitsGeoKey(3076.toUShort()),
}

enum class GeoTiffAngularUnits(val id: UShort) {
  // http://geotiff.maptools.org/spec/geotiff6.html#6.3.1.4
  AngularDegree(9102.toUShort()),
}

enum class GeoTiffLinearUnits(val id: UShort) {
  // http://geotiff.maptools.org/spec/geotiff6.html#6.3.1.3
  LinearMeter(9001.toUShort()),
}

enum class GeoTiffModelType(val id: UShort) {
  // http://geotiff.maptools.org/spec/geotiff6.html#6.3.1.1
  ModelTypeProjected(1.toUShort()),
  ModelTypeGeographic(2.toUShort()),
  ModelTypeGeocentric(3.toUShort()),
}

enum class GeoTiffRasterSpace(val id: UShort) {
  // http://geotiff.maptools.org/spec/geotiff6.html#6.3.1.2
  RasterPixelIsArea(1.toUShort()),
  RasterPixelIsPoint(2.toUShort()),
}
