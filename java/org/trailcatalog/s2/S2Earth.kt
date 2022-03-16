package org.trailcatalog.s2

import com.google.common.geometry.S1Angle

fun S1Angle.earthMeters(): Double {
  return radians() * 6371010.0
}