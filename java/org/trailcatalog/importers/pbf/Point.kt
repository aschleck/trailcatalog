package org.trailcatalog.importers.pbf;

// Name is the value of the bare name tag and is what we display, while names is every name tag the
// node carries, and empty unless the point is in a searchable category. Notable is whether the
// element links to Wikidata or Wikipedia, which search ranks first.
data class Point(
    val id: Long,
    val type: Int,
    val name: String?,
    val names: List<Name>,
    val notable: Boolean,
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
