package org.trailcatalog.importers.elevation.contour

import com.google.common.base.Joiner
import com.google.common.geometry.S1Angle
import com.google.common.geometry.S2LatLng
import com.google.common.geometry.S2LatLngRect
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture
import com.google.common.util.concurrent.MoreExecutors
import okhttp3.HttpUrl.Companion.toHttpUrl
import org.trailcatalog.common.EncodedByteBufferInputStream
import org.trailcatalog.common.IORuntimeException
import org.trailcatalog.importers.elevation.getCopernicus30mUrl
import org.wololo.flatgeobuf.HeaderMeta
import org.wololo.flatgeobuf.PackedRTree
import org.wololo.flatgeobuf.generated.ColumnType
import org.wololo.flatgeobuf.generated.Feature
import java.io.FileOutputStream
import java.nio.ByteOrder
import java.nio.channels.FileChannel
import java.nio.file.Files
import java.nio.file.Path
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import kotlin.io.path.deleteExisting
import kotlin.io.path.exists
import kotlin.io.path.fileSize
import kotlin.math.roundToInt

fun main(args: Array<String>) {
  val pool = MoreExecutors.listeningDecorator(Executors.newFixedThreadPool(4))

  val source = Path.of(args[0])
  val dest = Path.of(args[1])
  val temp = Files.createTempDirectory("dems")

  val glaciator = Glaciator(source.parent.resolve("glaciers.json"))

  val low = if (args.size >= 6) Pair(args[2].toInt(), args[3].toInt()) else Pair(-85, -180)
  val high = if (args.size >= 6) Pair(args[4].toInt(), args[5].toInt()) else Pair(85, 180)
  val tasks = ArrayList<ListenableFuture<*>>()
  for (lat in low.first until high.first) {
    tasks.add(pool.submit {
      print("\n${lat}")
    })
    for (lng in low.second until high.second) {
      tasks.add(pool.submit {
        generateAndSimplify(lat, lng, source, dest, temp, glaciator)
        print(".")
      })
    }
  }

  Futures.allAsList(tasks).get()
  pool.shutdown()
  temp.deleteExisting()
}

private fun generateAndSimplify(
    lat: Int, lng: Int, source: Path, dest: Path, temp: Path, glaciator: Glaciator) {
  val filename = getCopernicus30mUrl(lat, lng).toHttpUrl().pathSegments.last()
  val from = source.resolve(filename)

  if (!from.exists()) {
    return
  }

  val fgbFt = temp.resolve("${filename}_ft.fgb")
  val fgbM = temp.resolve("${filename}_m.fgb")
  runContour(from, fgbFt, 0.0, 6.096)
  runContour(from, fgbM, 0.0, 10.0)
  val ft = readFgbAndSimplify(fgbFt, true, glaciator)
  val m = readFgbAndSimplify(fgbM, false, glaciator)
  fgbFt.deleteExisting()
  fgbM.deleteExisting()

  val bound =
      S2LatLngRect.fromPointPair(
          S2LatLng.fromDegrees(lat.toDouble(), lng.toDouble()),
          S2LatLng.fromDegrees(lat.toDouble() + 1, lng.toDouble() + 1))
  val tile = contoursToTile(ft, m, bound, EXTENT_ONE_DEGREE, -1)
  FileOutputStream(dest.resolve("${filename}.mvt").toFile()).use {
    tile.writeTo(it)
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
    throw IORuntimeException("Failed\n\n" + Joiner.on("\n").join(errors))
  }
}

private fun readFgbAndSimplify(
    source: Path, unitIsFeet: Boolean, glaciator: Glaciator): List<Contour> {
  return glaciator.glaciate(readFgb(source, unitIsFeet))
      .sortedBy { it.height }
      .map {
        // Actually don't simplify...
        Contour(it.height, it.glacier, simplifyContour(it.points, S1Angle.degrees(0.0)))
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

