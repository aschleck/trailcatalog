package org.trailcatalog.importers.pbf;

import com.google.common.geometry.S2LatLng;
import com.google.common.geometry.S2LatLngRect;

public record LatLngRectE7(int lowLat, int lowLng, int highLat, int highLng) {

  public static LatLngRectE7 from(S2LatLngRect rect) {
    var low = rect.lo();
    var high = rect.hi();
    return new LatLngRectE7(low.lat().e7(), low.lng().e7(), high.lat().e7(), high.lng().e7());
  }

  public S2LatLngRect toS2LatLngRect() {
    return S2LatLngRect.fromPointPair(
        S2LatLng.fromE7(lowLat, lowLng),
        S2LatLng.fromE7(highLat, highLng));
  }
}
