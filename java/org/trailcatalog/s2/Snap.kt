package org.trailcatalog.s2

import com.google.common.geometry.S2Projections

/** The furthest a point can move when snapped to a level [level] cell, in radians. */
fun snapRadians(level: Int): Double {
  // Half a diagonal, because a point can land anywhere in the cell it snapped to.
  return S2Projections.MAX_DIAG.getValue(level) / 2.0
}

/** [snapRadians] in the Mercator units the simplifier measures in. */
fun snapEpsilon(level: Int): Double {
  // A Mercator unit is 180 degrees of longitude, so pi radians.
  return snapRadians(level) / Math.PI
}
