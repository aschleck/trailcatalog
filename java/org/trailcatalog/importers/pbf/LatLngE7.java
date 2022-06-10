package org.trailcatalog.importers.pbf;

import com.google.common.geometry.S2LatLng;

public record LatLngE7(int lat, int lng) {

  public S2LatLng toS2LatLng() {
    return S2LatLng.fromE7(lat, lng);
  }
}
