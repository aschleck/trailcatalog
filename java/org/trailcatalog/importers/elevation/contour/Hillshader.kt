package org.trailcatalog.importers.elevation.contour

import com.google.common.base.Joiner
import com.google.common.geometry.S2LatLngRect
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture
import com.google.common.util.concurrent.MoreExecutors
import org.trailcatalog.common.IORuntimeException
import org.trailcatalog.flags.FlagSpec
import org.trailcatalog.flags.createFlag
import org.trailcatalog.flags.parseFlags
import org.trailcatalog.importers.common.NotFoundException
import org.trailcatalog.importers.common.ProgressBar
import org.trailcatalog.s2.SimpleS2
import java.io.File
import java.nio.charset.StandardCharsets
import java.nio.file.Path
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import javax.imageio.ImageIO
import kotlin.io.path.deleteIfExists
import kotlin.math.floor
import kotlin.math.min
import kotlin.math.pow
import java.awt.image.PixelGrabber
import kotlin.io.path.exists
import kotlin.math.abs
import kotlin.math.asin
import kotlin.math.cos
import kotlin.math.sqrt

@FlagSpec("detail_zoom")
private val detailZoom = createFlag(9)

@FlagSpec("hillshade_resolution")
private val hillshadeResolution = createFlag(1.0)

@FlagSpec("max_zoom")
private val maxZoom = createFlag(12)

@FlagSpec("tile_resolution")
private val tileResolution = createFlag(512)

@FlagSpec("webp_lossless")
private val webpLossless = createFlag(false)

@FlagSpec("webp_quality")
private val webpQuality = createFlag(75)

fun main(args: Array<String>) {
  parseFlags(args)

  val pool = MoreExecutors.listeningDecorator(Executors.newFixedThreadPool(workerCount.value))

  val source = Path.of(args[0])
  val dest = Path.of(args[1])

  val tasks = ArrayList<ListenableFuture<*>>()
  val worldSize = 2.0.pow(detailZoom.value).toInt()
  val (low, high) =
      if (args.size >= 6) {
        Pair(args[2].toInt(), args[3].toInt()) to Pair(args[4].toInt(), args[5].toInt())
      } else {
        Pair(0, 0) to Pair(worldSize, worldSize)
      }

  val colors = File.createTempFile("colors", ".txt").toPath()
  colors.toFile().outputStream().bufferedWriter(StandardCharsets.US_ASCII).use {
    it.write("0 0 0 0 0\n") // nodata
    for (i in 1 until 256) {
      val v = i
      val a = min(255, 275 - i)
      it.write("${i} ${v} ${v} ${v} ${a}\n")
    }
  }

  ProgressBar(
      "Generating detail tiles",
      "tiles",
      (high.first - low.first) * (high.second - low.second)).use {
    for (y in low.second until high.second) {
      for (x in low.first until high.first) {
        tasks.add(
            pool.submit {
              val bound = tileToBound(x, y, detailZoom.value)
              try {
                val hillshade = generateHillshade(bound, source, colors)
                cropTile(x, y, detailZoom.value, hillshade, dest)
                hillshade.deleteIfExists()
              } catch (e: NotFoundException) {
                // who cares
              }
              it.increment()
            })
      }
    }

    Futures.allAsList(tasks).get()
  }

  colors.deleteIfExists()

  merge(0, 0, 0, dest)

  pool.shutdown()
}

private fun generateHillshade(bound: S2LatLngRect, source: Path, colors: Path): Path {
  val vrt = source.resolve("copernicus.vrt")
  val filename = (0..Integer.MAX_VALUE).random()
  val warped = source.resolve("${filename}_out_warp.tiff")
  runWarp(bound, vrt, warped)
  val shaded = source.resolve("${filename}_out_shaded.tiff")
  runGdaldem("hillshade", "-s", "1", warped.toString(), shaded.toString())
  warped.deleteIfExists()
  val colored = source.resolve("${filename}_out_colored.tiff")
  runGdaldem("color-relief", "-alpha", shaded.toString(), colors.toString(), colored.toString())
  shaded.deleteIfExists()
  return colored
}

private fun runWarp(bound: S2LatLngRect, source: Path, destination: Path) {
  val zone = floor((bound.center.lngDegrees() + 180) / 6 + 1).toInt()
  val projection = "EPSG:" + (if (bound.center.latDegrees() > 0) "326" else "327") + zone.toString().padStart(2, '0')

  val copernicusLat = abs(floor(bound.center.latDegrees())).toInt()
  val width = when {
    copernicusLat < 50 -> 3600 * 3
    copernicusLat < 60 -> 2400
    copernicusLat < 70 -> 1800
    copernicusLat < 80 -> 1200
    copernicusLat < 85 -> 720
    else -> 360
  }

  val meterResolution =
      2.0 / hillshadeResolution.value *
          SimpleS2.EARTH_RADIUS_METERS /
          width *
          asin(
              sqrt(
                    cos(bound.center.latRadians())
                      * cos(bound.center.latRadians())
                      * (1 - cos(1.0 / 360.0 * 2 * Math.PI))
                      / 2
              ))

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
      // We choose our resolution to match the 3600x3600 pixels per degree from Copernicus. If we
      // choose a resolution that has higher accuracy than we have, we get weird artifacts. If we
      // choose a resolution too small, we lose data. We'd expect the autoresolution stuff to work,
      // but for some reason it doesn't seem to with vrts.
      meterResolution,
      meterResolution,
      "--config",
      "GDAL_PAM_ENABLED",
      "no",
      source,
      destination,
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

private fun runGdaldem(vararg args: String) {
  val command = listOf("gdaldem", *args)
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

private fun cropTile(
    x: Int,
    y: Int,
    z: Int,
    source: Path,
    dest: Path) {
  val bound = tileToBound(x, y, z)

  val output = dest.resolve("${z}/${x}/${y}.webp")
  output.parent.toFile().mkdirs()
  runCrop(bound, source, output)

  if (isTransparent(output)) {
    output.deleteIfExists()
    return
  }

  if (z < maxZoom.value) {
    cropTile(x * 2 + 0, y * 2 + 0, z + 1, source, dest)
    cropTile(x * 2 + 0, y * 2 + 1, z + 1, source, dest)
    cropTile(x * 2 + 1, y * 2 + 0, z + 1, source, dest)
    cropTile(x * 2 + 1, y * 2 + 1, z + 1, source, dest)
  }
}

private fun runCrop(bound: S2LatLngRect, source: Path, destination: Path) {
  val command = listOf(
      "gdalwarp",
      "-srcnodata",
      0,
      "-t_srs",
      "EPSG:4326",
      "-te_srs",
      "EPSG:4326",
      "-te",
      // xMin yMin xMax yMax
      // Need the bounds checks to ensure wrapping is correct
      if (bound.lo().lngDegrees() == 180.0) -180 else bound.lo().lngDegrees(),
      if (bound.lo().latDegrees() == 90.0) -90 else bound.lo().latDegrees(),
      if (bound.hi().lngDegrees() == -180.0) 180 else bound.hi().lngDegrees(),
      if (bound.hi().latDegrees() == -90.0) -0 else bound.hi().latDegrees(),
      "-r",
      "cubic",
      "-ts",
      tileResolution.value,
      tileResolution.value,
      "--config",
      "GDAL_PAM_ENABLED",
      "no",
      "-co",
      "LOSSLESS=${if (webpLossless.value) "TRUE" else "FALSE"}",
      "-co",
      "QUALITY=${webpQuality.value}",
      "-overwrite",
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

private fun isTransparent(source: Path): Boolean {
  val image = ImageIO.read(source.toFile())
  val pixels = IntArray(tileResolution.value * tileResolution.value)
  PixelGrabber(
          image,
           0,
           0,
          tileResolution.value,
          tileResolution.value,
          pixels,
           0,
          tileResolution.value)
      .grabPixels()
  for (pixel in pixels) {
    if (((pixel ushr 24) and 0xff) != 0) {
      return false
    }
  }
  return true
}

private fun merge(x: Int, y: Int, z: Int, destination: Path) {
  if (z < detailZoom.value - 1) {
    merge(x * 2 + 0, y * 2 + 0, z + 1, destination)
    merge(x * 2 + 0, y * 2 + 1, z + 1, destination)
    merge(x * 2 + 1, y * 2 + 0, z + 1, destination)
    merge(x * 2 + 1, y * 2 + 1, z + 1, destination)
  }

  runMontage(x, y, z, destination)
}

private fun runMontage(x: Int, y: Int, z: Int, destination: Path) {
  val files = listOf(
      destination.resolve("${z + 1}/${x * 2 + 0}/${y * 2 + 0}.webp"),
      destination.resolve("${z + 1}/${x * 2 + 1}/${y * 2 + 0}.webp"),
      destination.resolve("${z + 1}/${x * 2 + 0}/${y * 2 + 1}.webp"),
      destination.resolve("${z + 1}/${x * 2 + 1}/${y * 2 + 1}.webp"))
  val nullable = files.map {
    if (it.exists()) it.toString() else "null:"
  }

  if (!nullable.any { it != "null:" }) {
    return
  }

  val out = destination.resolve("${z}/${x}/${y}.webp")
  out.parent.toFile().mkdirs()

  val command = listOf(
      "montage",
      "-background",
      "None",
      "-geometry",
      "${tileResolution.value / 2}x${tileResolution.value / 2}",
      *nullable.toTypedArray(),
      out,
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

