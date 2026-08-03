package org.trailcatalog.importers.basemap

import com.google.common.geometry.S2Earth
import com.google.common.geometry.S2LatLng
import com.google.common.geometry.S2Point
import org.trailcatalog.importers.pbf.LatLngE7

fun e7ToS2(latE7: Int, lngE7: Int): S2Point {
  return S2LatLng.fromE7(latE7, lngE7).toPoint()
}

/** Returns the arclength of a chain of points, so it ignores elevation. */
fun latLngsToMeters(points: List<LatLngE7>): Double {
  var radians = 0.0
  for (i in 1 until points.size) {
    radians += points[i - 1].toS2LatLng().getDistance(points[i].toS2LatLng()).radians()
  }
  return S2Earth.radiansToMeters(radians)
}

fun S2Point.toLatLngE7(): LatLngE7 {
  val ll = S2LatLng(this)
  return LatLngE7((ll.latDegrees() * 10_000_000).toInt(), (ll.lngDegrees() * 10_000_000).toInt())
}