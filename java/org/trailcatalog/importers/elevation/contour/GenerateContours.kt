package org.trailcatalog.importers.elevation.contour

import com.google.common.base.Joiner
import com.google.common.geometry.S2LatLng
import com.google.common.geometry.S2LatLngRect
import org.trailcatalog.common.EncodedByteBufferInputStream
import org.trailcatalog.common.IORuntimeException
import org.trailcatalog.importers.common.NotFoundException
import org.trailcatalog.importers.elevation.getCopernicus30mUrl
import org.trailcatalog.importers.elevation.tiff.GeoTiffReader
import org.trailcatalog.s2.SimpleS2
import org.wololo.flatgeobuf.HeaderMeta
import org.wololo.flatgeobuf.PackedRTree
import org.wololo.flatgeobuf.generated.ColumnType
import org.wololo.flatgeobuf.generated.Feature
import java.nio.ByteOrder
import java.nio.channels.FileChannel
import java.nio.file.Path
import java.util.concurrent.TimeUnit
import kotlin.io.path.deleteExisting
import kotlin.io.path.exists
import kotlin.io.path.fileSize
import kotlin.math.asin
import kotlin.math.cos
import kotlin.math.floor
import kotlin.math.roundToInt
import kotlin.math.sqrt

fun generateContours(bound: S2LatLngRect, source: Path, glaciator: Glaciator):
    Pair<List<Contour>, List<Contour>> {
  val vrt = source.resolve("copernicus.vrt")
  val filename = (0..Integer.MAX_VALUE).random()
  val warped = source.resolve("${filename}_warp.tiff")
  runWarp(bound, vrt, warped)
  val fgbFt = source.resolve("${filename}_ft.fgb")
  val fgbM = source.resolve("${filename}_m.fgb")
  runContour(warped, fgbFt, 0.0, 6.096)
  runContour(warped, fgbM, 0.0, 10.0)
  warped.deleteExisting()
  val ft = readFgbAndProcess(fgbFt, true, glaciator)
  val m = readFgbAndProcess(fgbM, false, glaciator)
  fgbFt.deleteExisting()
  fgbM.deleteExisting()

  return Pair(ft, m)
}

private fun runWarp(bound: S2LatLngRect, source: Path, destination: Path) {
  val zone = floor((bound.center.lngDegrees() + 180) / 6 + 1).toInt()
  val projection = "EPSG:" + (if (bound.center.latDegrees() > 0) "326" else "327") + zone.toString().padStart(2, '0')

  val closest =
      source.parent.resolve(
          getCopernicus30mUrl(bound.center.latDegrees().toInt(), bound.center.lngDegrees().toInt())
              .split("/")
              .last())
  if (!closest.exists()) {
    throw NotFoundException("no such tile")
  }

  val width = GeoTiffReader(closest).imageWidth
  val command = listOf(
      "gdalwarp",
      "-srcnodata",
      0,
      "-t_srs",
      projection,
      "-te_srs",
      "EPSG:4326",
      "-te",
      // xMin yMin xMax yMax
      if (bound.lo().lngDegrees() == 180.0) -180 else bound.lo().lngDegrees() - 0.1,
      if (bound.lo().latDegrees() == 90.0) -90 else bound.lo().latDegrees() - 0.1,
      if (bound.hi().lngDegrees() == -180.0) 180 else bound.hi().lngDegrees() + 0.1,
      if (bound.hi().latDegrees() == -90.0) -0 else bound.hi().latDegrees() + 0.1,
      "-r",
      "cubic",
      "-tr",
      2
          * SimpleS2.EARTH_RADIUS_METERS
          / width * 3
          * asin(
          sqrt(
              cos(bound.center.latRadians())
                  * cos(bound.center.latRadians())
                  * (1 - cos(1.0 / 360.0 * 2 * Math.PI))
                  / 2
          )),
      1.0 / 180.0 * Math.PI * SimpleS2.EARTH_RADIUS_METERS / 3600,
      "--config",
      "GDAL_PAM_ENABLED",
      "no",
      source.toString(),
      destination.toString(),
  )
  val process = ProcessBuilder(*command.map { it.toString() }.toTypedArray()).start()
  process.waitFor(5, TimeUnit.MINUTES)

  if (process.exitValue() != 0) {
    val errors = process.errorReader().readLines()
    throw IORuntimeException(
        "Failed:"
            + Joiner.on(" ").join(command)
            + "\n\n"
            + Joiner.on("\n").join(errors))
  }
}

private fun runContour(source: Path, destination: Path, offset: Double, interval: Double) {
  val command = listOf(
      "gdal_contour",
      "-a",
      "height",
      "-off",
      offset.toString(),
      "-i",
      interval.toString(),
      source.toString(),
      destination.toString(),
  )
  val process = ProcessBuilder(*command.toTypedArray()).start()
  process.waitFor(5, TimeUnit.MINUTES)

  if (process.exitValue() != 0) {
    val errors = process.errorReader().readLines()
    throw IORuntimeException(
        "Failed:"
            + Joiner.on(" ").join(command)
            + "\n\n"
            + Joiner.on("\n").join(errors))
  }
}

private fun readFgbAndProcess(
    source: Path, unitIsFeet: Boolean, glaciator: Glaciator): List<Contour> {
  return glaciator.glaciate(readFgb(source, unitIsFeet)).sortedBy { it.height }
}

private fun readFgb(source: Path, unitIsFeet: Boolean): List<Contour> {
  FileChannel.open(source).use {
    val buffer =
        it.map(FileChannel.MapMode.READ_ONLY, 0, source.fileSize())
            .order(ByteOrder.LITTLE_ENDIAN)
    EncodedByteBufferInputStream(buffer).use { stream ->
      val header = HeaderMeta.read(stream)

      if (header.indexNodeSize > 0) {
        stream.seek(
            stream.position().toUInt()
                + PackedRTree.calcSize(header.featuresCount.toInt(), header.indexNodeSize).toUInt())
      }

      val contours = ArrayList<Contour>()
      for (i in 0 until header.featuresCount) {
        val size = stream.readUInt()
        val feature = Feature.getRootAsFeature(buffer)
        buffer.position(buffer.position() + size.toInt())

        val propStream = EncodedByteBufferInputStream(feature.propertiesAsByteBuffer())
        var height: Double? = null
        while (propStream.hasRemaining()) {
          val id = propStream.readUShort()
          val column = header.columns[id.toInt()]
          val type = column.type

          when (type.toInt()) {
            ColumnType.Double -> {
              val value = propStream.readDouble()
              if (column.name == "height") {
                height = value
              }
            }
            ColumnType.Int -> propStream.readInt()
            else -> throw IllegalArgumentException("Unknown type ${type}")
          }
        }


        if (height == null) {
          continue
        }

        val points = ArrayList<S2LatLng>()
        val xys = feature.geometry().xyVector()
        for (j in 0 until xys.length() step 2) {
          points.add(S2LatLng.fromDegrees(xys[j + 1], xys[j]))
        }
        val heightInUnit = if (unitIsFeet) {
          height / 0.3048
        } else {
          height
        }
        contours.add(Contour(heightInUnit.roundToInt(), false, points))
      }
      return contours
    }
  }
}
