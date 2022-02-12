package org.trailcatalog.s2;

import com.google.common.geometry.S1Angle;
import com.google.common.geometry.S2CellId;
import com.google.common.geometry.S2LatLng;
import com.google.common.geometry.S2LatLngRect;
import com.google.common.geometry.S2RegionCoverer;
import java.util.ArrayList;
import jsinterop.annotations.JsMethod;
import jsinterop.annotations.JsType;

@JsType
public final class SimpleS2 {

  @JsMethod
  public static ArrayList<S2CellId> cover() {
    ArrayList<S2CellId> cells = new ArrayList<>();
    S2LatLngRect viewport =
        S2LatLngRect.fromPoint(S2LatLng.fromDegrees(37.424862, -122.154853)).expandedByDistance(S1Angle.degrees(0.01));
    ArrayList<S2CellId> atLevel = new ArrayList<>();
    for (int level = 14; level >= 0; --level) {
      S2RegionCoverer coverer =
          S2RegionCoverer.builder().setMaxCells(1000).setMinLevel(level).setMaxLevel(level).build();
      coverer.getCovering(viewport, atLevel);
      cells.addAll(atLevel);
    }
    return cells;
  }
}
