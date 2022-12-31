package org.trailcatalog.importers.pbf;

data class Point(
    val id: Long,
    val type: Int,
    val name: String?,
    val latLng: LatLngE7,
) : Comparable<Point> {

  override fun compareTo(other: Point): Int {
    val delta = id - other.id;
    if (delta < 0L) {
      return -1;
    } else if (delta == 0L) {
      return 0;
    } else {
      return 1;
    }
  }
}
