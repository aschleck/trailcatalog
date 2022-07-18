package org.trailcatalog.s2

import com.google.common.geometry.S1Angle

fun earthMetersToAngle(meters: Double): S1Angle {
  return S1Angle.radians(meters / 6371010.0)
}

fun S1Angle.earthMeters(): Double {
  return radians() * 6371010.0
}