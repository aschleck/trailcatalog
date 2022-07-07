package org.trailcatalog.importers.pbf;

import com.google.common.geometry.S2LatLng;
import com.google.common.geometry.S2Point;

public record LatLngE7(int lat, int lng) {

  public static LatLngE7 fromS2Point(S2Point point) {
    S2LatLng latLng = new S2LatLng(point);
    return new LatLngE7(latLng.lat().e7(), latLng.lng().e7());
  }

  public S2LatLng toS2LatLng() {
    return S2LatLng.fromE7(lat, lng);
  }
}
