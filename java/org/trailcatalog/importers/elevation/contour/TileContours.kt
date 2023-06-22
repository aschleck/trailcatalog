package org.trailcatalog.importers.elevation.contour

import com.google.common.collect.Lists
import com.google.common.geometry.S2LatLng
import com.google.common.geometry.S2LatLngRect
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture
import com.google.common.util.concurrent.MoreExecutors
import org.trailcatalog.importers.common.ProgressBar
import java.io.FileOutputStream
import java.nio.file.Path
import java.util.concurrent.Executors
import kotlin.io.path.deleteIfExists
import kotlin.math.asin
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.tanh

fun main(args: Array<String>) {
  val pool =
      MoreExecutors.listeningDecorator(
          Executors.newFixedThreadPool(Runtime.getRuntime().availableProcessors() - 2))

  val source = Path.of(args[0])
  val dest = Path.of(args[1])
  val glaciator = Glaciator(source.parent.resolve("glaciers.json"))

  val tasks = ArrayList<ListenableFuture<*>>()
  val base = 8
  val worldSize = 2.0.pow(base).toInt()
  val (low, high) =
      if (args.size >= 6) {
        Pair(args[2].toInt(), args[3].toInt()) to Pair(args[4].toInt(), args[5].toInt())
      } else {
        Pair(0, 0) to Pair(worldSize, worldSize)
      }

  ProgressBar("Generating tiles", "tiles", worldSize * worldSize).use {
    for (y in low.second until high.second) {
      for (x in low.first until high.first) {
        tasks.add(
            pool.submit {
              val bound = tileToBound(x, y, base)
              val result = generateContours(bound, source, glaciator)
              cropTile(x, y, base, dest, result.first, result.second)
              it.increment()
            })
      }
    }

    Futures.allAsList(tasks).get()
  }

  pool.shutdown()
}

private fun tileToBound(x: Int, y: Int, z: Int): S2LatLngRect {
  val worldSize = 2.0.pow(z)
  val latLow = asin(tanh((0.5 - (y + 1) / worldSize) * 2 * Math.PI)) / Math.PI * 180
  val lngLow = x / worldSize * 360 - 180
  val latHigh = asin(tanh((0.5 - y / worldSize) * 2 * Math.PI)) / Math.PI * 180
  val lngHigh = (x + 1) / worldSize * 360 - 180
  return S2LatLngRect.fromPointPair(
      S2LatLng.fromDegrees(latLow, lngLow), S2LatLng.fromDegrees(latHigh, lngHigh))
}

private fun cropTile(
    x: Int,
    y: Int,
    z: Int,
    dest: Path,
    contoursFt: List<Contour>,
    contoursM: List<Contour>) {
  val bound = tileToBound(x, y, z)
  val cropFt = crop(contoursFt, bound)
  val cropM = crop(contoursM, bound)

  val output = dest.resolve("${z}/${x}/${y}.mvt")
  if (cropFt.isEmpty() || cropM.isEmpty()) {
    output.deleteIfExists()
    return
  }

  if (z >= 9) {
    val tile = contoursToTile(cropFt, cropM, bound, EXTENT_TILE, z)
    output.parent.toFile().mkdirs()

    FileOutputStream(output.toFile()).use {
      tile.writeTo(it)
    }
  }

  if (z < 14) {
    cropTile(x * 2 + 0, y * 2 + 0, z + 1, dest, cropFt, cropM)
    cropTile(x * 2 + 0, y * 2 + 1, z + 1, dest, cropFt, cropM)
    cropTile(x * 2 + 1, y * 2 + 0, z + 1, dest, cropFt, cropM)
    cropTile(x * 2 + 1, y * 2 + 1, z + 1, dest, cropFt, cropM)
  }
}

private fun crop(contours: List<Contour>, view: S2LatLngRect): List<Contour> {
  val out = ArrayList<Contour>()
  for (contour in contours) {
    crop(contour, view, out)
  }
  return out
}

private fun crop(contour: Contour, view: S2LatLngRect, out: MutableList<Contour>) {
  var i = 0
  val lls = contour.points

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

    val first = max(0, i - 1)
    val after = min(lls.size, j + 1)
    i = j

    val count = after - first
    val span = Lists.newArrayListWithExpectedSize<S2LatLng>(count)
    for (p in first until after) {
      span.add(lls[p])
    }
    out.add(Contour(contour.height, contour.glacier, span))
  }
}
