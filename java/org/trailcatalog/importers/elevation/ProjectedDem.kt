package org.trailcatalog.importers.elevation

import com.google.common.geometry.S2LatLng
import com.google.common.geometry.S2LatLngRect
import org.slf4j.LoggerFactory
import mil.nga.tiff.FieldTagType
import mil.nga.tiff.FieldType
import mil.nga.tiff.TIFFImage
import mil.nga.tiff.TiffReader
import org.locationtech.proj4j.CRSFactory
import org.locationtech.proj4j.CoordinateTransform
import org.locationtech.proj4j.CoordinateTransformFactory
import org.locationtech.proj4j.ProjCoordinate
import java.io.File
import java.nio.FloatBuffer
import kotlin.math.roundToInt

private val logger = LoggerFactory.getLogger(ProjectedDem::class.java)

class ProjectedDem(private val file: File) {

  private val image: TIFFImage
  private val size: Pair<Int, Int>
  private val raster: FloatBuffer
  private val origin: Origin
  private val noDataValue: Float
  private val transform: CoordinateTransform
  private val bound: S2LatLngRect

  init {
    // http://geotiff.maptools.org/spec/geotiff2.6.html
    logger.info("Opening {}", file)
    image = TiffReader.readTiff(file)
    val directory = image.fileDirectories[0]
    size = Pair(directory.imageWidth.toInt(), directory.imageHeight.toInt())
    raster = directory.readRasters().sampleValues[0].asFloatBuffer()
    logger.info("Opened {}", file)

    if (directory.getFieldTypeForSample(0) != FieldType.FLOAT) {
      throw IllegalArgumentException(
          "Can't handle non-float rasters (${directory.getFieldTypeForSample(0)})")
    }

    if (directory[FieldTagType.ModelTransformation] != null) {
      throw IllegalArgumentException("Can't handle transformations")
    }

    if ((directory[FieldTagType.SamplesPerPixel].values as Int) != 1) {
      throw IllegalArgumentException("Can't handle multiple samples per pixel")
    }

    if (directory[FieldTagType.ModelTransformation] != null) {
      throw IllegalArgumentException("Can't handle transformations")
    }

    @Suppress("UNCHECKED_CAST")
    val tiepoints = directory[FieldTagType.ModelTiepoint].values as List<Double>
    if (tiepoints.size != 6) {
      throw IllegalArgumentException("Can't handle multiple tiepoints")
    }
    if (tiepoints[2] != 0.0 || tiepoints[5] != 0.0) {
      throw IllegalArgumentException("Can't handle vertical tiepoints")
    }
    if (tiepoints[0] != 0.0 || tiepoints[1] != 0.0) {
      throw IllegalArgumentException("Can't handle non-origin tiepoints")
    }

    @Suppress("UNCHECKED_CAST")
    val scale = directory[FieldTagType.ModelPixelScale].values as List<Double>
    if (scale[2] != 0.0) {
      throw IllegalArgumentException("Can't handle vertical pixel scales")
    }

    // TODO(april): is the -1 here correct? It seems plausible because these images are oriented with
    // north at y=0 and south at y=<big number>.
    origin = Origin(XyPair(tiepoints[3], tiepoints[4]), XyPair(scale[0], -1 * scale[1]))

    @Suppress("UNCHECKED_CAST")
    noDataValue = (directory[FieldTagType.GDAL_NODATA].values as List<String>).let {
      it[0].toFloat()
    }

    @Suppress("UNCHECKED_CAST")
    val geoKeys = directory[FieldTagType.GeoKeyDirectory].values as List<Short>
    // http://geotiff.maptools.org/spec/geotiff2.4.html
    var angularUnits = (-1).toShort()
    var epsg = (-1).toShort()
    var linearUnits = (-1).toShort()
    var modelType = (-1).toShort()
    var rasterType = (-1).toShort()
    for ((keyId, tiffTagLocation, count, valueOffset) in geoKeys.chunked(4)) {
      if (tiffTagLocation == 0.toShort() && count != 1.toShort()) {
        throw IllegalArgumentException("Expecting value count of 1")
      }
      when (keyId) {
        GeoTiffTagType.GTRasterTypeGeoKey.id -> {
          if (tiffTagLocation != 0.toShort()) {
            throw IllegalArgumentException("Unable to handle raster type TIFF tags")
          }
          rasterType = valueOffset
        }
        GeoTiffTagType.GTModelTypeGeoKey.id -> {
          if (tiffTagLocation != 0.toShort()) {
            throw IllegalArgumentException("Unable to handle model type TIFF tags")
          }
          modelType = valueOffset
        }
        GeoTiffTagType.GeodeticCRSGeoKey.id -> {
          if (tiffTagLocation != 0.toShort()) {
            throw IllegalArgumentException("Unable to handle GCRS TIFF tags")
          }
          epsg = valueOffset
        }
        GeoTiffTagType.GeogAngularUnitsGeoKey.id -> {
          if (tiffTagLocation != 0.toShort()) {
            throw IllegalArgumentException("Unable to handle angular units TIFF tags")
          }
          angularUnits = valueOffset
        }
        GeoTiffTagType.ProjLinearUnitsGeoKey.id -> {
          if (tiffTagLocation != 0.toShort()) {
            throw IllegalArgumentException("Unable to handle linear units TIFF tags")
          }
          linearUnits = valueOffset
        }
        GeoTiffTagType.ProjectedCSTypeGeoKey.id -> {
          if (tiffTagLocation != 0.toShort()) {
            throw IllegalArgumentException("Unable to handle PCS TIFF tags")
          }
          epsg = valueOffset
        }
      }
    }

    if (angularUnits != GeoTiffAngularUnits.AngularDegree.id) {
      throw IllegalArgumentException("Unable to handle non-degree angular units")
    }
    if (modelType == GeoTiffModelType.ModelTypeGeographic.id) {
      if (epsg < 0) {
        throw IllegalArgumentException("Unable to find the coordinate projection")
      }
    } else if (modelType == GeoTiffModelType.ModelTypeProjected.id) {
      if (epsg < 0) {
        throw IllegalArgumentException("Unable to find the coordinate projection")
      }
      if (linearUnits != GeoTiffLinearUnits.LinearMeter.id) {
        throw IllegalArgumentException("Unable to handle non-meter linear units")
      }
    } else {
      throw IllegalArgumentException("Unable to handle non-projected model types")
    }
    if (rasterType != GeoTiffRasterSpace.RasterPixelIsArea.id) {
      throw IllegalArgumentException("Unable to handle non-area raster pixels")
    }

    val factory = CRSFactory()
    val projection = factory.createFromName("EPSG:${epsg}")
    val wgs84 =
        factory.createFromParameters(
            "WGS84", "+title=long/lat:WGS84 +proj=longlat +datum=WGS84 +units=degrees")
    transform = CoordinateTransformFactory().createTransform(wgs84, projection)

    val inverse = CoordinateTransformFactory().createTransform(projection, wgs84)
    val coordinate = ProjCoordinate()
    val topLeft = ProjCoordinate().also {
      it.x = origin.modelPosition.x
      it.y = origin.modelPosition.y
    }
    val bottomRight = ProjCoordinate().also {
      it.x = origin.modelPosition.x + directory.imageWidth.toInt() * origin.rasterScale.x
      it.y = origin.modelPosition.y + directory.imageHeight.toInt() * origin.rasterScale.y
    }
    bound =
        S2LatLngRect.fromPointPair(
            inverse.transform(topLeft, coordinate).degreesToS2LatLng(),
            inverse.transform(bottomRight, coordinate).degreesToS2LatLng())
    logger.info("{}", bound.toStringDegrees())
  }

  @Override
  protected fun finalize() {
    println("Closing ${file}")
  }

  fun query(ll: S2LatLng): Float? {
    if (!bound.contains(ll)) {
      return null
    }

    val modelCoordinate = transform.transform(ll.toProjCoordinateDegrees(), ProjCoordinate())
    // TODO(april): some sort of filtering?
    val x = ((modelCoordinate.x - origin.modelPosition.x) / origin.rasterScale.x)
    val y = ((modelCoordinate.y - origin.modelPosition.y) / origin.rasterScale.y)
    val lx = x.toInt()
    val ly = y.toInt()
    val tlv = raster.get(ly * size.first + lx)
    val trv = raster.get(ly * size.first + (lx + 1))
    val blv = raster.get((ly + 1) * size.first + lx)
    val brv = raster.get((ly + 1) * size.first + (lx + 1))
    val fx = (x % 1).toFloat()
    val tv = mix(fx, tlv, trv)
    val bv = mix(fx, blv, brv)
    val value = mix((y % 1).toFloat(), tv, bv)
    return when (value) {
      noDataValue -> null
      else -> value
    }
  }
}

private fun mix(f: Float, a: Float, b: Float): Float {
  return (1 - f) * a + f * b
}