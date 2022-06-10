package org.trailcatalog.importers

import com.google.common.geometry.S2LatLng
import com.google.common.geometry.S2Point
import com.google.common.geometry.S2Polyline
import org.trailcatalog.importers.pbf.LatLngE7

fun e7ToS2(latE7: Int, lngE7: Int): S2Point {
  return S2LatLng.fromE7(latE7, lngE7).toPoint()
}

fun polylineToMeters(polyline: S2Polyline): Double {
  return polyline.arclengthAngle.radians() * 6371010.0
}

fun S2Point.toLatLngE7(): LatLngE7 {
  val ll = S2LatLng(this)
  return LatLngE7((ll.latDegrees() * 10_000_000).toInt(), (ll.lngDegrees() * 10_000_000).toInt())
}