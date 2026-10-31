package org.trailcatalog.importers.pbf

import com.google.common.geometry.S2Point
import com.google.common.geometry.S2Polygon

// The polygon's centroid, or the nearest point to it inside the polygon. A C-shaped lake or a
// glacier wrapping around a ridge has its centroid outside the water or the ice.
fun interiorPoint(polygon: S2Polygon): S2Point {
  val centroid = polygon.centroid.normalize()
  return if (polygon.contains(centroid)) centroid else polygon.project(centroid)
}
