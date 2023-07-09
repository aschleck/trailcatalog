package org.trailcatalog.importers.elevation.contour

import com.google.common.base.Preconditions
import com.google.common.collect.Lists
import com.google.common.geometry.S2LatLng
import com.google.common.geometry.S2LatLngRect
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture
import com.google.common.util.concurrent.MoreExecutors
import com.google.protobuf.CodedOutputStream
import com.mapbox.proto.vectortiles.Tile
import org.trailcatalog.flags.FlagSpec
import org.trailcatalog.flags.createFlag
import org.trailcatalog.flags.parseFlags
import org.trailcatalog.importers.common.NotFoundException
import org.trailcatalog.importers.common.ProgressBar
import java.io.FileOutputStream
import java.nio.file.Path
import java.util.concurrent.Executors
import kotlin.io.path.deleteIfExists
import kotlin.math.asin
import kotlin.math.ln
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.roundToInt
import kotlin.math.sin
import kotlin.math.tanh

@FlagSpec("base_zoom")
private val baseZoom = createFlag(8)

@FlagSpec("extent_tile")
private val extentTile = createFlag(4096)

@FlagSpec("worker_count")
val workerCount = createFlag(2)

fun main(args: Array<String>) {
  parseFlags(args)

  val pool = MoreExecutors.listeningDecorator(Executors.newFixedThreadPool(workerCount.value))

  val source = Path.of(args[0])
  val dest = Path.of(args[1])
  val glaciator = Glaciator(source.parent.resolve("glaciers.json"))

  val tasks = ArrayList<ListenableFuture<*>>()
  val worldSize = 2.0.pow(baseZoom.value).toInt()
  val (low, high) =
      if (args.size >= 6) {
        Pair(args[2].toInt(), args[3].toInt()) to Pair(args[4].toInt(), args[5].toInt())
      } else {
        Pair(0, 0) to Pair(worldSize, worldSize)
      }

  ProgressBar(
      "Generating tiles",
      "tiles",
      (high.first - low.first) * (high.second - low.second)).use {
    for (y in low.second until high.second) {
      for (x in low.first until high.first) {
        tasks.add(
            pool.submit {
              val bound = tileToBound(x, y, baseZoom.value)
              try {
                val result = generateContours(bound, source, glaciator)
                cropTile(x, y, baseZoom.value, dest, result.first, result.second)
              } catch (e: NotFoundException) {
                // who cares
              }
              it.increment()
            })
      }
    }

    Futures.allAsList(tasks).get()
  }

  pool.shutdown()
}

fun tileToBound(x: Int, y: Int, z: Int): S2LatLngRect {
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
    val tile = contoursToTile(cropFt, cropM, bound, extentTile.value, z)
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

private fun contoursToTile(
    contoursFt: List<Contour>,
    contoursM: List<Contour>,
    bound: S2LatLngRect,
    extent: Int,
    z: Int): Tile {
  val ftIncrement = zToFtIncrement(z)
  val mIncrement = zToMIncrement(z)
  return Tile.newBuilder()
      .addLayers(
          contoursToLayer(
              "contour",
              contoursM.filter { it.height % mIncrement == 0 },
              mIncrement,
              bound,
              extent))
      .addLayers(
          contoursToLayer(
              "contour_ft",
              contoursFt.filter { it.height % ftIncrement == 0 },
              ftIncrement,
              bound,
              extent))
      .build()
}

private fun contoursToLayer(
    name: String,
    contours: List<Contour>,
    every: Int,
    bound: S2LatLngRect,
    extent: Int): Tile.Layer {
  val grouped = contours.groupBy { Pair(it.height, it.glacier) }

  val layer =
      Tile.Layer.newBuilder()
          .setName(name)
          .setExtent(extent)
          .setVersion(2)
          .addKeys("height")
          .addKeys("nth_line")
          .addKeys("glacier")
          .addValues(Tile.Value.newBuilder().setIntValue(1))
          .addValues(Tile.Value.newBuilder().setIntValue(2))
          .addValues(Tile.Value.newBuilder().setIntValue(5))
          .addValues(Tile.Value.newBuilder().setIntValue(10))
  for ((key, level) in grouped) {
    val (height, glacier) = key
    val valueId = layer.valuesCount
    layer.addValuesBuilder().intValue = height.toLong()

    val feature = layer.addFeaturesBuilder().setType(Tile.GeomType.LINESTRING)
    feature
        .addTags(0)
        .addTags(valueId)
        .addTags(1)
        .addTags(
            (height / every).let {
              if (it % 10 == 0) {
                3
              } else if (it % 5 == 0) {
                2
              } else if (it % 2 == 0) {
                1
              } else {
                0
              }
            }
        )

    if (glacier) {
      feature.addTags(2).addTags(0)
    }

    var x = 0
    var y = 0
    for (contour in level) {
      val projected = project(contour.points, bound, extent)
      val smoothed = smooth(projected)
      val xys = simplifyContour(smoothed)
      feature
          .addGeometry(9) // moveto
          .addGeometry(CodedOutputStream.encodeZigZag32(xys[0] - x))
          .addGeometry(CodedOutputStream.encodeZigZag32(xys[1] - y))
      x = xys[0]
      y = xys[1]
      Preconditions.checkState(xys.size / 2 < 536870912) // 2^29 is max count
      feature.addGeometry(2 or (xys.size / 2 - 1 shl 3))
      for (i in 2 until xys.size step 2) {
        feature
            .addGeometry(CodedOutputStream.encodeZigZag32(xys[i + 0] - x))
            .addGeometry(CodedOutputStream.encodeZigZag32(xys[i + 1] - y))
        x = xys[i + 0]
        y = xys[i + 1]
      }
    }
  }
  return layer.build()
}

private fun zToFtIncrement(z: Int): Int {
  return when (z) {
    -1 -> 20
    9 -> 500
    10 -> 200
    11 -> 100
    12 -> 100
    13 -> 20
    14 -> 20
    else -> throw IllegalArgumentException("Unhandled zoom")
  }
}

private fun zToMIncrement(z: Int): Int {
  return when (z) {
    -1 -> 10
    9 -> 250
    10 -> 100
    11 -> 50
    12 -> 20
    13 -> 20
    14 -> 10
    else -> throw IllegalArgumentException("Unhandled zoom")
  }
}

private fun project(points: List<S2LatLng>, bound: S2LatLngRect, extent: Int): List<Int> {
  val low = project(bound.lo())
  val high = project(bound.hi())
  val dx = high.first - low.first
  val dy = high.second - low.second

  val xys = Lists.newArrayListWithExpectedSize<Int>(points.size * 2)
  for (point in points) {
    val (x, y) = project(point)
    xys.add(((x - low.first) / dx * extent).roundToInt())
    xys.add(((high.second - y) / dy * extent).roundToInt())
  }
  return xys
}

private fun project(ll: S2LatLng): Pair<Double, Double> {
  val x = ll.lngRadians() / Math.PI
  val latRadians = ll.latRadians()
  val y = ln((1 + sin(latRadians)) / (1 - sin(latRadians))) / (2 * Math.PI)
  return Pair(x, y)
}

