package org.trailcatalog.importers.elevation.contour

import com.google.common.base.Preconditions
import com.google.common.cache.CacheBuilder
import com.google.common.cache.CacheLoader
import com.google.common.collect.Lists
import com.google.common.geometry.S2LatLng
import com.google.common.geometry.S2LatLngRect
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture
import com.google.common.util.concurrent.MoreExecutors
import okhttp3.HttpUrl.Companion.toHttpUrl
import org.trailcatalog.importers.common.ProgressBar
import org.trailcatalog.importers.elevation.getCopernicus30mUrl
import java.io.FileOutputStream
import java.nio.file.Path
import java.util.concurrent.Executors
import kotlin.io.path.exists
import kotlin.math.asin
import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.pow
import kotlin.math.tanh

data class ContourAndRect(val contour: Contour, val bound: S2LatLngRect)
data class RawTile(val contours: List<ContourAndRect>)

fun main(args: Array<String>) {
  val pool =
      MoreExecutors.listeningDecorator(
          Executors.newFixedThreadPool(Runtime.getRuntime().availableProcessors() / 2))

  val source = Path.of(args[0])
  val dest = Path.of(args[1])

  val cache =
      CacheBuilder
          .newBuilder()
          .maximumSize(8)
          .build(object : CacheLoader<Pair<Int, Int>, Pair<RawTile, RawTile>>() {
            override fun load(p0: Pair<Int, Int>): Pair<RawTile, RawTile> {
              val (lat, lng) = p0
              val mvt = source.resolve(getCopernicusMvt(lat, lng))
              val contoursFt = ArrayList<Contour>()
              val contoursM = ArrayList<Contour>()
              if (mvt.exists()) {
                loadContourMvt(
                    contoursFt,
                    contoursM,
                    mvt,
                    S2LatLngRect.fromPointPair(
                        S2LatLng.fromDegrees(lat.toDouble(), lng.toDouble()),
                        S2LatLng.fromDegrees(lat.toDouble() + 1, lng.toDouble() + 1)))
              }
              return Pair(makeRawTile(contoursFt), makeRawTile(contoursM))
            }
          })

  val tasks = ArrayList<ListenableFuture<*>>()
  val base = 9
  val worldSize = 2.0.pow(base).toInt()
  val sequence =
      if (args.size >= 6) {
        val low = Pair(args[2].toInt(), args[3].toInt())
        val high = Pair(args[4].toInt(), args[5].toInt())
        hilbert(worldSize, low, high)
      } else {
        hilbert(worldSize, Pair(0, 0), Pair(worldSize, worldSize))
      }

  ProgressBar("Generating tiles", "tiles", worldSize * worldSize).use {
    for ((x, y) in sequence) {
      tasks.add(
          pool.submit {
            val bound = tileToBound(x, y, base)
            val tiles = sequence {
              val latLow = floor(bound.latLo().degrees()).toInt()
              val latHigh = ceil(bound.latHi().degrees()).toInt()
              val lngLow = floor(bound.lngLo().degrees()).toInt()
              val lngHigh = ceil(bound.lngHi().degrees()).toInt()
              for (lat in latLow until latHigh) {
                for (lng in lngLow until lngHigh) {
                  yield(Pair(lat, lng))
                }
              }
            }

            // We shuffle this sequence so that worker threads don't all block waiting on the same tile
            val contoursFt = ArrayList<Contour>()
            val contoursM = ArrayList<Contour>()
            tiles.shuffled().forEach { ll ->
              val result = cache[ll]
              contoursFt.addAll(
                  result.first.contours.filter { bound.intersects(it.bound) }.map { it.contour })
              contoursM.addAll(
                  result.second.contours.filter { bound.intersects(it.bound) }.map { it.contour })
            }

            cropTile(x, y, base, dest, contoursFt, contoursM)
            it.increment()
          })
    }

    Futures.allAsList(tasks).get()
  }

  pool.shutdown()
}

private fun getCopernicusMvt(lat: Int, lng: Int): String {
  return getCopernicus30mUrl(lat, lng).toHttpUrl().pathSegments.last() + ".mvt"
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

  if (cropFt.isEmpty() || cropM.isEmpty()) {
    return
  }

  val tile = contoursToTile(cropFt, cropM, bound, EXTENT_TILE, z, true)
  val output = dest.resolve("${z}/${x}/${y}.pbf")
  output.parent.toFile().mkdirs()

  FileOutputStream(output.toFile()).use {
    tile.writeTo(it)
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

    val first = 0.coerceAtLeast(i - 1)
    val after = lls.size.coerceAtMost(j + 1)
    val count = after - first
    val span = Lists.newArrayListWithExpectedSize<S2LatLng>(count)
    for (p in first until after) {
      span.add(lls[p])
    }
    out.add(Contour(contour.height, contour.glacier, span))

    i = j
  }
}

private fun hilbert(n: Int, low: Pair<Int, Int>, high: Pair<Int, Int>) = sequence {
  val dx = high.first - low.first
  val dy = high.second - low.second
  Preconditions.checkArgument(dx == dy, "Must be square")
  Preconditions.checkArgument((dx and (dx - 1)) == 0, "Must be a power of 2")

  for (d in 0 until dx * dy) {
    var x = 0
    var y = 0
    var t = d
    var s = 1
    while (s < n) {
      val rx = 1 and (t / 2)
      val ry = 1 and (t xor rx)
      if (ry == 0) {
        if (rx == 1) {
          x = s - 1 - x
          y = s - 1 - y
        }

        val tmp = x
        x = y
        y = tmp
      }
      x += s * rx
      y += s * ry
      t /= 4
      s *= 2
    }

    yield(Pair(low.first + x, low.second + y))
  }
}

private fun makeRawTile(contours: List<Contour>): RawTile {
  return RawTile(
      contours
          .filter { it.points.size > 1 }
          .map { c ->
            ContourAndRect(
                c,
                S2LatLngRect.empty().toBuilder().also { bound ->
                  c.points.forEach { bound.addPoint(it) }
                }.build())
          })
}
