package org.trailcatalog.importers.elevation.contour

import com.google.common.collect.Lists
import com.google.common.geometry.S2LatLng
import com.google.common.geometry.S2LatLngRect
import com.google.protobuf.CodedInputStream
import com.google.protobuf.CodedOutputStream
import com.mapbox.proto.vectortiles.Tile
import org.trailcatalog.common.IORuntimeException
import java.io.FileInputStream
import java.nio.file.Path
import kotlin.math.asin
import kotlin.math.hypot
import kotlin.math.ln
import kotlin.math.roundToInt
import kotlin.math.sin
import kotlin.math.sqrt
import kotlin.math.tanh

data class Contour(val height: Int, val glacier: Boolean, val points: List<S2LatLng>)

const val EXTENT_TILE = 4096

fun contoursToTile(
    contoursFt: List<Contour>,
    contoursM: List<Contour>,
    bound: S2LatLngRect,
    extent: Int,
    z: Int,
    smooth: Boolean): Tile {
  val ftIncrement = zToFtIncrement(z)
  val mIncrement = zToMIncrement(z)
  return Tile.newBuilder()
      .addLayers(
          contoursToLayer(
              "contour",
              contoursM.filter { it.height % mIncrement == 0 },
              mIncrement,
              bound,
              extent,
              smooth))
      .addLayers(
          contoursToLayer(
              "contour_ft",
              contoursFt.filter { it.height % ftIncrement == 0 },
              ftIncrement,
              bound,
              extent,
              smooth))
      .build()
}

private fun contoursToLayer(
    name: String,
    contours: List<Contour>,
    every: Int,
    bound: S2LatLngRect,
    extent: Int,
    smooth: Boolean): Tile.Layer {
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
      val smoothed = if (smooth) smooth(projected) else projected
      val xys = simplifyContour(smoothed)
      feature
          .addGeometry(9) // moveto
          .addGeometry(CodedOutputStream.encodeZigZag32(xys[0] - x))
          .addGeometry(CodedOutputStream.encodeZigZag32(xys[1] - y))
      x = xys[0]
      y = xys[1]
      for (i in 2 until xys.size step 2) {
        feature
            .addGeometry(10)
            .addGeometry(CodedOutputStream.encodeZigZag32(xys[i + 0] - x))
            .addGeometry(CodedOutputStream.encodeZigZag32(xys[i + 1] - y))
        x = xys[i + 0]
        y = xys[i + 1]
      }
    }
  }
  return layer.build()
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

fun project(ll: S2LatLng): Pair<Double, Double> {
  val x = ll.lngRadians() / Math.PI
  val latRadians = ll.latRadians()
  val y = ln((1 + sin(latRadians)) / (1 - sin(latRadians))) / (2 * Math.PI)
  return Pair(x, y)
}

fun unproject(
    x: Int, y: Int, low: Pair<Double, Double>, high: Pair<Double, Double>, extent: Int): S2LatLng {
  val dx = high.first - low.first
  val dy = high.second - low.second

  val xw = low.first + dx * x / extent
  val yw = high.second - dy * y / extent
  return S2LatLng.fromRadians(asin(tanh(yw * Math.PI)), Math.PI * xw)
}

fun loadContourMvt(
    contoursFt: MutableList<Contour>,
    contoursM: MutableList<Contour>,
    path: Path,
    bound: S2LatLngRect) {
  val tile = FileInputStream(path.toFile()).use {
    Tile.parseFrom(it)
  }

  val low = project(bound.lo())
  val high = project(bound.hi())

  for (layer in tile.layersList) {
    val contours =
        when (layer.name) {
          "contour" -> contoursM
          "contour_ft" -> contoursFt
          else -> throw IORuntimeException("Unknown layer name ${layer.name}")
        }

    for (feature in layer.featuresList) {
      if (feature.type != Tile.GeomType.LINESTRING) {
        throw IORuntimeException("Cannot read anything but linestrings")
      }

      var glacier: Int? = null
      var height: Int? = null
      for (i in 0 until feature.tagsCount step 2) {
        when (layer.getKeys(feature.getTags(i))) {
          "height" -> height = layer.getValues(feature.getTags(i + 1)).intValue.toInt()
          "glacier" -> glacier = layer.getValues(feature.getTags(i + 1)).intValue.toInt()
        }
      }

      if (height == null) {
        throw IORuntimeException("Unknown height")
      }

      var i = 0
      var x = 0
      var y = 0
      var building: ArrayList<S2LatLng>? = null
      while (i < feature.geometryCount) {
        val tag = feature.getGeometry(i)
        i += 1

        val command = tag.and(7)
        val count = tag.ushr(3)
        if (command == 1) { // move to
          var j = 0
          while (j < count) {
            building = ArrayList()
            contours.add(Contour(height, (glacier ?: 0) > 0, building))

            x += CodedInputStream.decodeZigZag32(feature.getGeometry(i + 0))
            y += CodedInputStream.decodeZigZag32(feature.getGeometry(i + 1))
            building.add(unproject(x, y, low, high, layer.extent))
            j += 1
            i += 2
          }
        } else if (command == 2) {
          var j = 0
          while (j < count) {
            x += CodedInputStream.decodeZigZag32(feature.getGeometry(i + 0))
            y += CodedInputStream.decodeZigZag32(feature.getGeometry(i + 1))
            building!!.add(unproject(x, y, low, high, layer.extent))
            j += 1
            i += 2
          }
        } else {
          throw IORuntimeException("Unknown command ${command}")
        }
      }
    }
  }
}

private fun simplifyContour(xys: List<Int>): List<Int> {
  val out = ArrayList<Int>()
  douglasPeucker(0, xys.size / 2 - 1, xys, out)
  return out
}

private tailrec fun douglasPeucker(
    start: Int, last: Int, points: List<Int>, out: ArrayList<Int>) {
  val p1 = Pair(points[start * 2 + 0], points[start * 2 + 1])
  val p2 = Pair(points[last * 2 + 0], points[last * 2 + 1])
  var split = -1
  for (i in start + 1 until last) {
    val p = Pair(points[i * 2 + 0], points[i * 2 + 1])
    if (pointSegmentDistance(p, p1, p2) > 8) {
      split = i
      break
    }
  }

  if (split < 0) {
    out.add(points[start * 2 + 0])
    out.add(points[start * 2 + 1])
    out.add(points[last * 2 + 0])
    out.add(points[last * 2 + 1])
  } else {
    douglasPeucker(start, split, points, out)
    out.removeAt(out.size - 1)
    out.removeAt(out.size - 1)
    douglasPeucker(split, last, points, out)
  }
}

fun pointSegmentDistance(p0: Pair<Int, Int>, p1: Pair<Int, Int>, p2: Pair<Int, Int>): Double {
  // https://stackoverflow.com/a/6853926
  val a = p0.first - p1.first
  val b = p0.second - p1.second
  val c = p2.first - p1.first
  val d = p2.second - p1.second

  val len2 = c * c + d * d
  val param = if (len2 != 0) {
    1.0 * (a * c + b * d) / len2
  } else {
    -1.0
  }

  val (xx, yy) = when {
    param < 0 -> Pair(p1.first, p1.second)
    param > 1 -> Pair(p2.first, p2.second)
    else -> Pair(p1.first + param * c, p1.second + param * d)
  }

  val dx = p0.first - xx.toDouble()
  val dy = p0.second - yy.toDouble()
  return hypot(dx, dy)
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

private fun smooth(xys: List<Int>): List<Int> {
  // We do the Centripetal Catmull–Rom
  val out = ArrayList<Int>()
  out.add(xys[0])
  out.add(xys[1])
  for (i in 1 until xys.size / 2 - 2) {
    out.add(xys[i * 2 + 0])
    out.add(xys[i * 2 + 1])

    val p0 = Point(xys[(i - 1) * 2 + 0], xys[(i - 1) * 2 + 1])
    val p1 = Point(xys[i * 2 + 0], xys[i * 2 + 1])
    val p2 = Point(xys[(i + 1) * 2 + 0], xys[(i + 1) * 2 + 1])
    val p3 = Point(xys[(i + 2) * 2 + 0], xys[(i + 2) * 2 + 1])

    if (p0 == p1 || p1 == p2 || p2 == p3 || p3 == p0) {
      continue
    }

    val t0 = 0.0
    val t1 = tj(t0, p0, p1)
    val t2 = tj(t1, p1, p2)
    val t3 = tj(t2, p2, p3)

    for (f in 1 until 5) {
      val t = (1 - f / 5.0) * t1 + f / 5.0 * t2
      val a1 = (t1 - t) / (t1 - t0) * p0 + (t - t0) / (t1 - t0) * p1
      val a2 = (t2 - t) / (t2 - t1) * p1 + (t - t1) / (t2 - t1) * p2
      val a3 = (t3 - t) / (t3 - t2) * p2 + (t - t2) / (t3 - t2) * p3
      val b1 = (t2 - t) / (t2 - t0) * a1 + (t - t0) / (t2 - t0) * a2
      val b2 = (t3 - t) / (t3 - t1) * a2 + (t - t1) / (t3 - t1) * a3
      val p = (t2 - t) / (t2 - t1) * b1 + (t - t1) / (t2 - t1) * b2
      out.add(p.x.roundToInt())
      out.add(p.y.roundToInt())
    }
  }

  Point(xys[(xys.size / 2 - 2) * 2 + 0], xys[(xys.size / 2 - 2) * 2 + 1]).also {
    out.add(it.x.roundToInt())
    out.add(it.y.roundToInt())
  }
  Point(xys[(xys.size / 2 - 1) * 2 + 0], xys[(xys.size / 2 - 1) * 2 + 1]).also {
    out.add(it.x.roundToInt())
    out.add(it.y.roundToInt())
  }
  return out
}

private fun tj(ti: Double, pi: Point, pj: Point): Double {
  val d = pj - pi
  val l = sqrt(d.x * d.x + d.y * d.y)
  return ti + sqrt(l)
}

private class Point(val x: Double, val y: Double) {

  constructor(xI: Int, yI: Int) : this(xI.toDouble(), yI.toDouble())

  fun distance(o: Point): Double {
    return sqrt((x - o.x) * (x - o.x) + (y - o.y) * (y - o.y))
  }

  override fun equals(other: Any?): Boolean {
    return other is Point && x == other.x && y == other.y
  }

  override fun hashCode(): Int {
    return 31 * x.hashCode() + y.hashCode()
  }

  operator fun div(s: Number): Point {
    return Point(x / s.toDouble(), y / s.toDouble())
  }

  operator fun minus(o: Point): Point {
    return Point(x - o.x, y - o.y)
  }

  operator fun plus(o: Point): Point {
    return Point(x + o.x, y + o.y)
  }

  operator fun times(s: Number): Point {
    return Point(s.toDouble() * x, s.toDouble() * y)
  }
}

private operator fun Double.times(p: Point): Point {
  return p * this
}