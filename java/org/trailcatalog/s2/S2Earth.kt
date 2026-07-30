package org.trailcatalog.s2

import com.google.common.geometry.S1Angle

fun earthMetersToAngle(meters: Double): S1Angle {
  return SimpleS2.earthMetersToAngle(meters)
}

fun S1Angle.earthMeters(): Double {
  return SimpleS2.angleToEarthMeters(this)
}

fun earthSteradiansToMeters2(steradians: Double): Double {
  val radius = SimpleS2.EARTH_RADIUS_METERS.toDouble()
  return steradians * radius * radius
}
