package org.trailcatalog.importers.elevation.contour

import com.google.common.collect.Lists
import com.google.common.geometry.S2LatLng
import com.google.common.geometry.S2LatLngRect
import org.trailcatalog.flags.FlagSpec
import org.trailcatalog.flags.createFlag
import java.util.PriorityQueue
import kotlin.math.abs
import kotlin.math.hypot
import kotlin.math.ln
import kotlin.math.roundToInt
import kotlin.math.sin
import kotlin.math.sqrt

data class Contour(val height: Int, val glacier: Boolean, val points: List<S2LatLng>)

enum class SimplificationStrategy {
  NONE,
  DOUGLAS_PEUCKER,
  VISVALINGAM_WHYATT,
}

@FlagSpec("simplification_strategy")
private val simplificationStrategy = createFlag(SimplificationStrategy.VISVALINGAM_WHYATT)
@FlagSpec("douglas_peucker_threshold")
private val douglasPeuckerThreshold = createFlag(8)
@FlagSpec("visvalingam_threshold")
private val visvalingamThreshold = createFlag(75)

fun project(points: List<S2LatLng>, bound: S2LatLngRect, extent: Int): List<Int> {
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

fun simplifyContour(xys: List<Int>): List<Int> {
  return when (simplificationStrategy.value) {
    SimplificationStrategy.NONE -> xys
    SimplificationStrategy.DOUGLAS_PEUCKER ->
      ArrayList<Int>().also {
        douglasPeucker(0, xys.size / 2 - 1, xys, it)
      }
    SimplificationStrategy.VISVALINGAM_WHYATT -> visvalingamWhyatt(xys)
  }
}

private data class Triangle(
    val i: Int,
    var value: Int,
    var previous: Triangle?,
    var next: Triangle?)
    : Comparable<Triangle> {

  override fun compareTo(other: Triangle): Int {
    val d = value - other.value
    return when {
      d < 0.0 -> -1
      d > 0.0 -> 1
      else -> 0
    }
  }
}

private fun visvalingamWhyatt(xys: List<Int>): List<Int> {
  val heap = PriorityQueue<Triangle>()
  val first = Triangle(0, Int.MAX_VALUE, null, null)
  heap.add(first)
  var previous = first
  for (i in 1 until xys.size / 2 - 1) {
    val area = triangleArea2(i - 1, i, i + 1, xys)
    val current = Triangle(i, area, previous, null)
    heap.add(current)
    previous.next = current
    previous = current
  }
  val last = Triangle(xys.size / 2 - 1, Int.MAX_VALUE, previous, null)
  heap.add(last)
  previous.next = last

  while (heap.isNotEmpty()) {
    val minimum = heap.poll()
    if (minimum.value > visvalingamThreshold.value) {
      break
    }

    val p = minimum.previous!!
    val n = minimum.next!!
    p.next = n
    n.previous = p

    p.previous?.let {
      pp ->
      heap.remove(p)
      p.value = triangleArea2(pp.i, p.i, n.i, xys)
      heap.add(p)
    }

    n.next?.let {
      nn ->
      heap.remove(n)
      n.value = triangleArea2(p.i, n.i, nn.i, xys)
      heap.add(n)
    }
  }

  val output = Lists.newArrayListWithExpectedSize<Int>(2 * heap.size)
  var current: Triangle? = first
  while (current != null) {
    val i = current.i
    output.add(xys[i * 2 + 0])
    output.add(xys[i * 2 + 1])
    current = current.next
  }
  return output
}

private tailrec fun douglasPeucker(
    start: Int, last: Int, points: List<Int>, out: ArrayList<Int>) {
  val p1 = Pair(points[start * 2 + 0], points[start * 2 + 1])
  val p2 = Pair(points[last * 2 + 0], points[last * 2 + 1])
  var split = -1
  for (i in start + 1 until last) {
    val p = Pair(points[i * 2 + 0], points[i * 2 + 1])
    if (pointSegmentDistance(p, p1, p2) > douglasPeuckerThreshold.value) {
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

private fun pointSegmentDistance(p0: Pair<Int, Int>, p1: Pair<Int, Int>, p2: Pair<Int, Int>): Double {
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

fun smooth(xys: List<Int>): List<Int> {
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

private fun triangleArea2(i: Int, j: Int, k: Int, xys: List<Int>): Int {
  return abs(
      xys[i * 2 + 0] * xys[j * 2 + 1]
          + xys[j * 2 + 0] * xys[k * 2 + 1]
          + xys[k * 2 + 0] * xys[i * 2 + 1]
          - xys[i * 2 + 0] * xys[k * 2 + 1]
          - xys[j * 2 + 0] * xys[i * 2 + 1]
          - xys[k * 2 + 0] * xys[j * 2 + 1]
  )
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