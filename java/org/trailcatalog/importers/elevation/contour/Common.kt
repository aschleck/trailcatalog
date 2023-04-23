package org.trailcatalog.importers.elevation.contour

import com.google.common.collect.Lists
import com.google.common.geometry.S1Angle
import com.google.common.geometry.S1ChordAngle
import com.google.common.geometry.S2Edge
import com.google.common.geometry.S2EdgeUtil
import com.google.common.geometry.S2LatLng
import com.google.common.geometry.S2LatLngRect
import com.google.common.geometry.S2Point
import com.google.protobuf.CodedOutputStream
import com.mapbox.proto.vectortiles.Tile
import kotlin.math.ln
import kotlin.math.roundToInt
import kotlin.math.sin

data class Contour(val height: Int, val points: List<S2Point>)

const val EXTENT_ONE_DEGREE = 4096
const val EXTENT_TILE = 4096

fun contoursToTile(
    contoursFt: List<Contour>, contoursM: List<Contour>, bound: S2LatLngRect, extent: Int): Tile {
  return Tile.newBuilder()
      .addLayers(contoursToLayer("contours_ft", contoursFt, 20, bound, extent))
      .addLayers(contoursToLayer("contours", contoursM, 10, bound, extent))
      .build()
}

private fun contoursToLayer(
    name: String,
    contours: List<Contour>,
    every: Int,
    bound: S2LatLngRect,
    extent: Int): Tile.Layer {
  val grouped = contours.groupBy { it.height }

  val layer =
      Tile.Layer.newBuilder()
          .setName(name)
          .setExtent(extent)
          .setVersion(2)
          .addKeys("height")
          .addKeys("nth_line")
          .addValues(Tile.Value.newBuilder().setIntValue(1))
          .addValues(Tile.Value.newBuilder().setIntValue(2))
          .addValues(Tile.Value.newBuilder().setIntValue(5))
          .addValues(Tile.Value.newBuilder().setIntValue(10))
  for ((height, level) in grouped) {
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

private fun project(points: List<S2Point>, bound: S2LatLngRect, extent: Int): List<Int> {
  val low = project(bound.lo())
  val high = project(bound.hi())
  val dx = high.first - low.first
  val dy = high.second - low.second

  val xys = Lists.newArrayListWithExpectedSize<Int>(points.size * 2)
  for (point in points) {
    val (x, y) = project(S2LatLng(point))
    xys.add(((x - low.first) / dx * extent).roundToInt())
    xys.add(((y - low.second) / dy * extent).roundToInt())
  }
  return xys
}

fun project(ll: S2LatLng): Pair<Double, Double> {
  val x = ll.lngRadians() / Math.PI
  val latRadians = ll.latRadians()
  val y = ln((1 + sin(latRadians)) / (1 - sin(latRadians))) / (2 * Math.PI)
  return Pair(x, y)
}

fun simplifyContour(points: List<S2Point>, tolerance: S1Angle): List<S2Point> {
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
