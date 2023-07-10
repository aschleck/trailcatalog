package org.trailcatalog.importers.elevation.tiff

import com.google.common.cache.CacheBuilder
import com.google.common.cache.CacheLoader
import com.google.common.geometry.S2LatLng
import mil.nga.tiff.compression.CompressionDecoder
import mil.nga.tiff.compression.DeflateCompression
import mil.nga.tiff.compression.LZWCompression
import mil.nga.tiff.compression.Predictor
import org.locationtech.proj4j.CRSFactory
import org.locationtech.proj4j.CoordinateTransform
import org.locationtech.proj4j.CoordinateTransformFactory
import org.locationtech.proj4j.ProjCoordinate
import org.trailcatalog.common.*
import java.io.Closeable
import java.nio.ByteBuffer
import java.nio.ByteOrder.LITTLE_ENDIAN
import java.nio.channels.FileChannel
import java.nio.channels.FileChannel.MapMode
import java.nio.file.Path
import kotlin.io.path.deleteIfExists
import kotlin.io.path.fileSize

data class XyPair(val x: Double, val y: Double)

data class Origin(val modelPosition: XyPair, val rasterScale: XyPair)

interface DemReader : Closeable {
  override fun close() {}
  fun query(ll: S2LatLng): Float?
}

class ConstantReader(private val value: Float?) : DemReader {

  override fun query(ll: S2LatLng): Float? {
    return value
  }
}

class GeoTiffReader(private val path: Path) : DemReader {

  private val stream: EncodedByteBufferInputStream
  private val decompressor: CompressionDecoder
  private val imageWidth: Int
  private val imageHeight: Int
  private var predictor = PredictorType.None.id
  private val tileWidth: Int
  private val tileHeight: Int
  private val tileOffsets: ArrayList<UInt>
  private val tileByteSizes: ArrayList<UInt>
  private val origin: Origin
  private val translate: XyPair
  private val transform: CoordinateTransform
  private val noData: Float

  private val decompressed =
      CacheBuilder.newBuilder().weakValues().build(object : CacheLoader<Int, ByteArray>() {
        override fun load(p0: Int) = decompressTile(p0)
      })

  init {
    FileChannel.open(path).use { channel ->
      stream = EncodedByteBufferInputStream(channel.map(MapMode.READ_ONLY, 0, path.fileSize()))
    }

    if (stream.readShort() != 0x4949.toShort()) {
      throw IllegalArgumentException("Tiff does not appear to be in little-endian")
    }
    if (stream.readShort() != 0x2A.toShort()) {
      throw IllegalArgumentException("Tiff does not appear to be in little-endian")
    }

    stream.seek(stream.readUInt())
    val directorySize = stream.readShort()
    var width = 0.toUShort()
    var height = 0.toUShort()
    var compression = 0.toUShort()
    var tileWidth = 0.toUShort()
    var tileHeight = 0.toUShort()
    var tileOffsetList: ValueList? = null
    var tileByteCounts: ValueList? = null
    var sampleFormat = 0.toUShort()
    var geoKeyDirectoryOffset: ValueList? = null
    var modelTiepointOffset: ValueList? = null
    var pixelScaleOffset: ValueList? = null
    var gdalNoDataOffset: ValueList? = null
    for (i in 0 until directorySize) {
      val tag = stream.readUShort()
      val type = stream.readUShort()
      val valueCount = stream.readUInt()
      val valueOffset = stream.readUInt()

      when (tag) {
        TiffTagType.ImageWidth.id -> width = assertSingleShort(type, valueCount, valueOffset)
        TiffTagType.ImageHeight.id -> height = assertSingleShort(type, valueCount, valueOffset)
        TiffTagType.Compression.id -> compression = assertSingleShort(type, valueCount, valueOffset)
        TiffTagType.Predictor.id -> predictor = assertSingleShort(type, valueCount, valueOffset)
        TiffTagType.TileWidth.id -> tileWidth = assertSingleShort(type, valueCount, valueOffset)
        TiffTagType.TileLength.id -> tileHeight = assertSingleShort(type, valueCount, valueOffset)
        TiffTagType.TileOffsets.id -> tileOffsetList = assertUIntList(type, valueCount, valueOffset)
        TiffTagType.TileByteCounts.id ->
          tileByteCounts = assertUIntList(type, valueCount, valueOffset)
        TiffTagType.SampleFormat.id ->
          sampleFormat = assertSingleShort(type, valueCount, valueOffset)
        TiffTagType.GeoKeyDirectoryTag.id -> geoKeyDirectoryOffset =
            assertUShortList(type, valueCount, valueOffset)
        TiffTagType.ModelTiepointTag.id -> modelTiepointOffset =
            assertDoubleList(type, valueCount, valueOffset)
        TiffTagType.ModelPixelScaleTag.id -> pixelScaleOffset =
            assertDoubleList(type, valueCount, valueOffset)
        TiffTagType.GDAL_NODATA.id -> gdalNoDataOffset =
            assertAsciiList(type, valueCount, valueOffset)
        TiffTagType.BitsPerSample.id -> {
          if (assertSingleShort(type, valueCount, valueOffset) != 32.toUShort()) {
            throw IllegalArgumentException("Only support 32-bit samples")
          }
        }
        TiffTagType.SamplesPerPixel.id -> {
          if (assertSingleShort(type, valueCount, valueOffset) != 1.toUShort()) {
            throw IllegalArgumentException("Only support one-dimensional tiffs")
          }
        }
//        else -> {
//          println("${tag} ${type} ${valueCount} ${valueOffset}")
//        }
      }
    }

    // who cares about other directories?

    if (width == 0.toUShort() || height == 0.toUShort()) {
      throw IllegalArgumentException("Unable to find image size information")
    }
    imageWidth = width.toInt()
    imageHeight = height.toInt()

    if (tileWidth == 0.toUShort() || tileHeight == 0.toUShort()) {
      throw IllegalArgumentException("Unable to find tile size information")
    }
    this.tileWidth = tileWidth.toInt()
    this.tileHeight = tileHeight.toInt()

    decompressor = if (compression == CompressionType.AdobeDeflate.id) {
      DeflateCompression()
    } else if (compression == CompressionType.Lzw.id) {
      LZWCompression()
    } else {
      throw IllegalArgumentException("Unknown compression type: ${compression}")
    }

    if (sampleFormat != SampleFormat.Float.id) {
      throw IllegalArgumentException("Expected floating point samples")
    }

    if (tileOffsetList == null || tileByteCounts == null) {
      throw IllegalArgumentException("Unable to find tile byte information")
    }

    stream.seek(tileOffsetList.offset)
    tileOffsets = ArrayList(tileOffsetList.count.toInt())
    for (i in 0.toUInt() until tileOffsetList.count) {
      tileOffsets.add(stream.readUInt())
    }
    stream.seek(tileByteCounts.offset)
    tileByteSizes = ArrayList()
    for (i in 0.toUInt() until tileByteCounts.count) {
      tileByteSizes.add(stream.readUInt())
    }

    if (modelTiepointOffset == null) {
      throw IllegalArgumentException("Expected model tiepoints")
    }
    if (modelTiepointOffset.count != 6.toUInt()) {
      throw IllegalArgumentException("Expected model tiepoints to have length 6")
    }
    stream.seek(modelTiepointOffset.offset)
    val tie =
      if (stream.readDouble() != 0.0 || stream.readDouble() != 0.0 || stream.readDouble() != 0.0) {
        throw IllegalArgumentException("Tie point must be at <0, 0, 0>")
      } else {
        val x = stream.readDouble()
        val y = stream.readDouble()
        if (stream.readDouble() != 0.0) {
          throw IllegalArgumentException("Tie point origin must be at z=0")
        }
        XyPair(x, y)
      }

    if (pixelScaleOffset == null) {
      throw IllegalArgumentException("Expected pixel scale")
    }
    if (pixelScaleOffset.count != 3.toUInt()) {
      throw IllegalArgumentException("Expected pixel scale to have length 3")
    }
    stream.seek(pixelScaleOffset.offset)
    val scale = XyPair(stream.readDouble(), -1 * stream.readDouble())

    origin = Origin(tie, scale)

    if (geoKeyDirectoryOffset == null) {
      throw IllegalArgumentException("Expected geo keys")
    }
    stream.seek(geoKeyDirectoryOffset.offset)

    // http://geotiff.maptools.org/spec/geotiff2.4.html
    var angularUnits = 0.toUShort()
    var epsg = 0.toUShort()
    var linearUnits = 0.toUShort()
    var modelType = 0.toUShort()
    var rasterType = 0.toUShort()
    if (stream.readUShort() != 1.toUShort()) {
      throw IllegalArgumentException("Unknown geo keys version")
    }
    stream.readUShort()
    stream.readUShort()
    val keyCount = stream.readUShort()
    for (i in 0.toUShort() until keyCount) {
      val keyId = stream.readUShort()
      val tiffTagLocation = stream.readUShort()
      val count = stream.readUShort()
      val valueOffset = stream.readUShort()

      if (tiffTagLocation == 0.toUShort() && count != 1.toUShort()) {
        throw IllegalArgumentException("Expecting value count of 1")
      }

      when (keyId) {
        GeoTiffTagType.GTRasterTypeGeoKey.id -> {
          if (tiffTagLocation != 0.toUShort()) {
            throw IllegalArgumentException("Unable to handle raster type TIFF tags")
          }
          rasterType = valueOffset
        }
        GeoTiffTagType.GTModelTypeGeoKey.id -> {
          if (tiffTagLocation != 0.toUShort()) {
            throw IllegalArgumentException("Unable to handle model type TIFF tags")
          }
          modelType = valueOffset
        }
        GeoTiffTagType.GeodeticCRSGeoKey.id -> {
          if (tiffTagLocation != 0.toUShort()) {
            throw IllegalArgumentException("Unable to handle GCRS TIFF tags")
          }
          epsg = valueOffset
        }
        GeoTiffTagType.GeogAngularUnitsGeoKey.id -> {
          if (tiffTagLocation != 0.toUShort()) {
            throw IllegalArgumentException("Unable to handle angular units TIFF tags")
          }
          angularUnits = valueOffset
        }
        GeoTiffTagType.ProjLinearUnitsGeoKey.id -> {
          if (tiffTagLocation != 0.toUShort()) {
            throw IllegalArgumentException("Unable to handle linear units TIFF tags")
          }
          linearUnits = valueOffset
        }
        GeoTiffTagType.ProjectedCSTypeGeoKey.id -> {
          if (tiffTagLocation != 0.toUShort()) {
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
      if (epsg == 0.toUShort()) {
        throw IllegalArgumentException("Unable to find the coordinate projection")
      }
    } else if (modelType == GeoTiffModelType.ModelTypeProjected.id) {
      if (epsg == 0.toUShort()) {
        throw IllegalArgumentException("Unable to find the coordinate projection")
      }
      if (linearUnits != GeoTiffLinearUnits.LinearMeter.id) {
        throw IllegalArgumentException("Unable to handle non-meter linear units")
      }
    } else {
      throw IllegalArgumentException("Unable to handle non-projected model types")
    }

    // TODO(april): is this right?
    if (rasterType == GeoTiffRasterSpace.RasterPixelIsArea.id) {
      translate = XyPair(0.0, 0.0)
    } else if (rasterType == GeoTiffRasterSpace.RasterPixelIsPoint.id) {
      translate = XyPair(-0.5, -0.5)
    } else {
      throw IllegalArgumentException("Unknown raster type: ${rasterType}")
    }

    val factory = CRSFactory()
    val projection = factory.createFromName("EPSG:${epsg}")
    val wgs84 =
        factory.createFromParameters(
            "WGS84", "+title=long/lat:WGS84 +proj=longlat +datum=WGS84 +units=degrees")
    transform = CoordinateTransformFactory().createTransform(wgs84, projection)

    if (gdalNoDataOffset != null) {
      stream.seek(gdalNoDataOffset.offset)
      val noDataString = StringBuilder()
      for (i in 0.toUInt() until gdalNoDataOffset.count) {
        noDataString.append(stream.read().toChar())
      }
      noData = noDataString.toString().toFloat()
    } else {
      noData = 999999f // TODO(april): ?
    }
  }

  override fun close() {
    stream.close()
    path.deleteIfExists()
  }

  @Override
  fun finalize() {
    stream.close()
  }

  override fun query(ll: S2LatLng): Float? {
    val modelCoordinate = transform.transform(ll.toProjCoordinateDegrees(), ProjCoordinate())
    // TODO(april): some sort of filtering?
    val x = ((modelCoordinate.x - origin.modelPosition.x) / origin.rasterScale.x) + translate.x
    val y = ((modelCoordinate.y - origin.modelPosition.y) / origin.rasterScale.y) + translate.y
    val lx = x.toInt()
    val ly = y.toInt()
    val tlv = query(lx, ly)
    val trv = query(lx + 1, ly)
    val blv = query(lx, ly + 1)
    val brv = query(lx + 1, ly + 1)
    val fx = (x % 1).toFloat()
    val fy = (y % 1).toFloat()
    if (tlv != null && trv != null && blv != null && brv != null) {
      val tv = mix(fx, tlv, trv)
      val bv = mix(fx, blv, brv)
      return mix(fy, tv, bv)
    } else if (tlv != null && trv != null) {
      return mix(fx, tlv, trv)
    } else if (tlv != null && blv != null) {
      return mix(fy, tlv, blv)
    } else if (tlv != null) {
      return tlv
    } else {
      return brv
    }
  }

  fun query(x: Int, y: Int): Float? {
    if (x < 0 || x >= imageWidth || y < 0 || y >= imageHeight) {
      return null
    }

    val tileX = x / tileWidth
    val tileY = y / tileHeight
    val tilesInRow = (imageWidth + tileWidth - 1) / tileWidth
    val tile = tileY * tilesInRow + tileX
    val value =
        ByteBuffer.wrap(decompressed.get(tile))
            .order(LITTLE_ENDIAN)
            .asFloatBuffer()
            .position((y % tileHeight) * tileWidth + (x % tileWidth))
            .get()
    return when (value) {
      noData -> null
      else -> value
    }
  }

  private fun decompressTile(i: Int): ByteArray {
    stream.seek(tileOffsets[i])
    val compressed = ByteArray(tileByteSizes[i].toInt())
    val read = stream.read(compressed)
    if (read != compressed.size) {
      throw IllegalStateException("Didn't read the whole tile")
    }
    val decoded = decompressor.decode(compressed, LITTLE_ENDIAN)
    return Predictor.decode(decoded, predictor.toInt(), tileWidth, tileHeight, listOf(32), 1)
  }
}

private fun assertSingleShort(type: UShort, valueCount: UInt, valueOffset: UInt): UShort {
  if (type != TiffDataType.UShort.id) {
    throw IllegalArgumentException("Expected ushort, got ${type}")
  }
  if (valueCount != 1.toUInt()) {
    throw IllegalArgumentException("Expected single, got ${valueCount}")
  }
  return valueOffset.toUShort()
}

data class ValueList(val count: UInt, val offset: UInt)

private fun assertAsciiList(type: UShort, valueCount: UInt, valueOffset: UInt): ValueList {
  if (type != TiffDataType.Ascii.id) {
    throw IllegalArgumentException("Expected ascii, got ${type}")
  }
  return ValueList(valueCount, valueOffset)
}

private fun assertDoubleList(type: UShort, valueCount: UInt, valueOffset: UInt): ValueList {
  if (type != TiffDataType.Double.id) {
    throw IllegalArgumentException("Expected double, got ${type}")
  }
  return ValueList(valueCount, valueOffset)
}

private fun assertUIntList(type: UShort, valueCount: UInt, valueOffset: UInt): ValueList {
  if (type != TiffDataType.UInt.id) {
    throw IllegalArgumentException("Expected uint, got ${type}")
  }
  return ValueList(valueCount, valueOffset)
}

private fun assertUShortList(type: UShort, valueCount: UInt, valueOffset: UInt): ValueList {
  if (type != TiffDataType.UShort.id) {
    throw IllegalArgumentException("Expected ushort, got ${type}")
  }
  return ValueList(valueCount, valueOffset)
}

private fun mix(f: Float, a: Float, b: Float): Float {
  return (1 - f) * a + f * b
}

private fun ProjCoordinate.degreesToS2LatLng(): S2LatLng {
  return S2LatLng.fromDegrees(y, x)
}

private fun S2LatLng.toProjCoordinateDegrees(): ProjCoordinate {
  return ProjCoordinate().also {
    it.x = lngDegrees()
    it.y = latDegrees()
  }
}
