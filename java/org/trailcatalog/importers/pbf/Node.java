package org.trailcatalog.importers.pbf;

public record Node(long id, LatLngE7 latLng) implements Comparable<Node> {

  @Override
  public int compareTo(Node o) {
    var delta = id - o.id;
    if (delta < 0) {
      return -1;
    } else if (delta == 0) {
      return 0;
    } else {
      return 1;
    }
  }
}
