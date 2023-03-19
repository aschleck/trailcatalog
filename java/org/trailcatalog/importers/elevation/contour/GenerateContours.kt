package org.trailcatalog.importers.elevation.contour

import com.google.common.geometry.S1Angle
import com.google.common.geometry.S1ChordAngle
import com.google.common.geometry.S2Edge
import com.google.common.geometry.S2EdgeUtil
import com.google.common.geometry.S2LatLng
import com.google.common.geometry.S2LatLngRect
import com.google.common.geometry.S2Point
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import org.trailcatalog.common.EncodedByteBufferInputStream
import org.trailcatalog.common.EncodedOutputStream
import org.trailcatalog.common.ChannelEncodedOutputStream
import org.trailcatalog.importers.elevation.getCopernicus30mUrl
import org.trailcatalog.importers.pipeline.io.ByteBufferEncodedOutputStream
import org.wololo.flatgeobuf.HeaderMeta
import org.wololo.flatgeobuf.PackedRTree
import org.wololo.flatgeobuf.generated.ColumnType
import org.wololo.flatgeobuf.generated.Feature
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.channels.FileChannel
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardOpenOption
import java.util.concurrent.TimeUnit
import kotlin.io.path.exists
import kotlin.io.path.fileSize
import kotlin.math.*

fun main(args: Array<String>) {
  val directory = Files.createTempDirectory("dems")
  val tiff = directory.resolve("dem.tif")
  val fgbFt = directory.resolve("contours_ft.fgb")
  val fgbM = directory.resolve("contours_m.fgb")
  val cache = Path.of(args[0]).resolve("degrees")
  cache.toFile().mkdirs()
  val final = Path.of(args[0]).resolve("mercator")
  final.toFile().mkdirs()

  val low = if (args.size >= 5) Pair(args[1].toInt(), args[2].toInt()) else Pair(-90, -180)
  val high = if (args.size >= 5) Pair(args[3].toInt(), args[4].toInt()) else Pair(90, 180)

  for (lat in low.first until high.first) {
    for (lng in low.second until high.second) {
      val pbFt = cache.resolve("contours_${lat}_${lng}_ft.cbf")
      val pbM = cache.resolve("contours_${lat}_${lng}_m.cbf")
      try {
        runDecog(getCopernicus30mUrl(lat, lng).toHttpUrl(), tiff)
      } catch (e: IllegalArgumentException) {
        continue
      }
      runContour(tiff, fgbFt, 0.0, 12.192)
      runContour(tiff, fgbM, 0.0, 10.0)
      convertFgb(fgbFt, pbFt, true)
      convertFgb(fgbM, pbM, false)
    }
  }

  val zoomLevel = 10
  val worldSize = 2.0.pow(zoomLevel)
  for (y in 0 until worldSize.toInt()) {
    for (x in 0 until worldSize.toInt()) {
      val latLow = asin(tanh((y / worldSize - 0.5) * 2 * Math.PI)) / Math.PI * 180
      val lngLow = x / worldSize * 360 - 180
      val latHigh = asin(tanh(((y + 1) / worldSize - 0.5) * 2 * Math.PI)) / Math.PI * 180
      val lngHigh = (x + 1) / worldSize * 360 - 180

      for (unit in listOf("ft", "m")) {
        val needed = HashSet<Path>()
        needed.add(cache.resolve("contours_${floor(latLow).toInt()}_${floor(lngLow).toInt()}_${unit}.cbf"))
        needed.add(cache.resolve("contours_${floor(latLow).toInt()}_${ceil(lngHigh).toInt()}_${unit}.cbf"))
        needed.add(cache.resolve("contours_${ceil(latHigh).toInt()}_${floor(lngLow).toInt()}_${unit}.cbf"))
        needed.add(cache.resolve("contours_${ceil(latHigh).toInt()}_${ceil(lngHigh).toInt()}_${unit}.cbf"))
        needed.removeIf { !it.exists() }

        if (needed.isEmpty()) {
          continue
        }

        println("Generating ${x},${y}")
        val view =
            S2LatLngRect(S2LatLng.fromDegrees(latLow, lngLow), S2LatLng.fromDegrees(latHigh, lngHigh))
        val out = final.resolve("${zoomLevel}/${x}/${y}_${unit}.cbf")
        out.parent.toFile().mkdirs()
        mergeAndCrop(needed, view, out)
      }
    }
  }
}

private fun runDecog(url: HttpUrl, path: Path) {
  val decog = Runfiles.rlocation("trailcatalog/java/org/trailcatalog/scrapers/decog")
  val command = listOf(decog, url.toString(), path.toString())
  println("Starting ${command}")
  val process = ProcessBuilder(*command.toTypedArray()).inheritIO().start()
  process.waitFor(5, TimeUnit.MINUTES)
  if (process.exitValue() != 0) {
    throw IllegalArgumentException("Failed to download $url")
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
  println("Starting ${command}")
  ProcessBuilder(*command.toTypedArray()).inheritIO().start().waitFor(5, TimeUnit.MINUTES)
}

private fun convertFgb(source: Path, destination: Path, unitIsFeet: Boolean) {
  println("Reading contours and simplifying")
  val contours = readFgb(source, unitIsFeet)
  val simplified =
      contours.sortedBy { it.height }
          .map { Contour(it.height, simplifyContour(it.points, S1Angle.degrees(0.0001))) }

  FileChannel.open(destination, StandardOpenOption.CREATE, StandardOpenOption.TRUNCATE_EXISTING, StandardOpenOption.WRITE)
      .use {
        ChannelEncodedOutputStream(it).use { stream ->
          val out = ArrayList<ByteArray>()
          for (contour in simplified) {
            out.addAll(cropAndDump(contour, S2LatLngRect.full()))
          }

          stream.writeVarInt(out.size)
          out.forEach { bytes -> stream.write(bytes) }
          stream.flush()
        }
      }
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

        val points = ArrayList<S2Point>()
        val xys = feature.geometry().xyVector()
        for (j in 0 until xys.length() step 2) {
          points.add(S2LatLng.fromDegrees(xys[j + 1], xys[j]).toPoint())
        }
        val heightInUnit = if (unitIsFeet) {
          height / 0.3048
        } else {
          height
        }
        contours.add(Contour(heightInUnit.roundToInt(), points))
      }
      return contours
    }
  }
}

private fun simplifyContour(points: List<S2Point>, tolerance: S1Angle): List<S2Point> {
  val chord = S1ChordAngle.fromS1Angle(tolerance)
  val out = ArrayList<S2Point>()
  douglasPeucker(0, points.size - 1, points, chord, out)
  return out
}

private tailrec fun douglasPeucker(
    start: Int, last: Int, points: List<S2Point>, tolerance: S1ChordAngle, out: ArrayList<S2Point>) {
  val edge = S2Edge(points[start], points[last])
  var split = -1
  for (i in start + 1 until last) {
    if (S2EdgeUtil.getDistance(points[i], edge) > tolerance) {
      split = i
      break
    }
  }

  if (split < 0) {
    out.add(points[start])
    out.add(points[last])
  } else {
    douglasPeucker(start, split, points, tolerance, out)
    out.removeAt(out.size - 1)
    douglasPeucker(split, last, points, tolerance, out)
  }
}

private fun cropAndDump(contour: Contour, view: S2LatLngRect): List<ByteArray> {
  var i = 0
  val lls = contour.points.map { S2LatLng(it) }

  val out = ArrayList<ByteArray>()
  while (i < lls.size) {
    while (i < lls.size && !view.contains(lls[i])) {
      i += 1
    }

    if (i == lls.size) {
      break
    }

    var j = i + 1
    while (j < lls.size && view.contains(lls[j])) {
      j += 1
    }

    if (j - i > 1) {
      val buffer =
          ByteBuffer.allocate(
              EncodedOutputStream.varIntSize(contour.height)
              + EncodedOutputStream.varIntSize(j - i)
              + 2 * 4 * (j - i))

      ByteBufferEncodedOutputStream(buffer).use {
        it.writeVarInt(contour.height)
        it.writeVarInt(j - i)
        for (p in i until j) {
          val ll = lls[p]
          it.writeInt(ll.lat().e7())
          it.writeInt(ll.lng().e7())
        }
      }
      out.add(buffer.array())
    }

    i = j
  }

  return out
}

private fun mergeAndCrop(needed: HashSet<Path>, view: S2LatLngRect, out: Path) {
  val contours = ArrayList<Contour>()
  for (path in needed) {
    FileChannel.open(path, StandardOpenOption.READ).use {
      val buffer =
          it.map(FileChannel.MapMode.READ_ONLY, 0, path.fileSize())
              .order(ByteOrder.LITTLE_ENDIAN)
      EncodedByteBufferInputStream(buffer).use { stream ->
        val count = stream.readVarInt()
        for (i in 0 until count) {
          val height = stream.readVarInt()
          val points =
              MutableList<S2Point>(stream.readVarInt()) {
                S2LatLng.fromE7(stream.readInt(), stream.readInt()).toPoint()
              }
          contours.add(Contour(height, points))
        }
      }
    }
  }

  FileChannel.open(out, StandardOpenOption.CREATE, StandardOpenOption.TRUNCATE_EXISTING, StandardOpenOption.WRITE).use {
    ChannelEncodedOutputStream(it).use { stream ->
      val cropped = ArrayList<ByteArray>()
      for (contour in contours) {
        cropped.addAll(cropAndDump(contour, view))
      }

      println(contours.size)
      println(cropped.size)
      stream.writeVarInt(cropped.size)
      cropped.forEach { stream.write(it) }
      stream.flush()
    }
  }
}

private data class Contour(val height: Int, val points: List<S2Point>)