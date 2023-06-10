package org.trailcatalog.importers.elevation.contour

import com.google.common.collect.Lists
import com.google.common.geometry.S1Angle
import com.google.common.geometry.S1ChordAngle
import com.google.common.geometry.S2Edge
import com.google.common.geometry.S2EdgeUtil
import com.google.common.geometry.S2LatLng
import com.google.common.geometry.S2LatLngRect
import com.google.common.geometry.S2Point
import com.google.protobuf.CodedInputStream
import com.google.protobuf.CodedOutputStream
import com.mapbox.proto.vectortiles.Tile
import org.trailcatalog.common.IORuntimeException
import java.io.FileInputStream
import java.nio.file.Path
import kotlin.math.asin
import kotlin.math.ln
import kotlin.math.roundToInt
import kotlin.math.sin
import kotlin.math.tanh

data class Contour(val height: Int, val glacier: Boolean, val points: List<S2LatLng>)

const val EXTENT_ONE_DEGREE = 4096 * 512
const val EXTENT_TILE = 4096

fun contoursToTile(
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
      val xys = project(contour.points, bound, extent)
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

      var height: Int? = null
      for (i in 0 until feature.tagsCount step 2) {
        if (layer.getKeys(feature.getTags(i)) == "height") {
          height = layer.getValues(feature.getTags(i + 1)).intValue.toInt()
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
            contours.add(Contour(height, false, building))

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

fun simplifyContour(lls: List<S2LatLng>, tolerance: S1Angle): List<S2LatLng> {
  val chord = S1ChordAngle.fromS1Angle(tolerance)
  val points = lls.map { it.toPoint() }
  val out = ArrayList<S2Point>()
  douglasPeucker(0, points.size - 1, points, chord, out)
  return out.map { S2LatLng(it) }
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
    9 -> 200
    10 -> 100
    11 -> 50
    12 -> 20
    13 -> 20
    14 -> 10
    else -> throw IllegalArgumentException("Unhandled zoom")
  }
}
