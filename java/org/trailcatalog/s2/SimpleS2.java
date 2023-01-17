package org.trailcatalog.s2;

import static java.lang.StrictMath.max;

import com.google.common.geometry.S1Interval;
import com.google.common.geometry.S2CellId;
import com.google.common.geometry.S2CellUnion;
import com.google.common.geometry.S2LatLng;
import com.google.common.geometry.S2LatLngRect;
import com.google.common.geometry.S2Point;
import com.google.common.geometry.S2Polygon;
import com.google.common.geometry.S2RegionCoverer;
import elemental2.core.ArrayBuffer;
import elemental2.core.Uint8Array;
import elemental2.core.JsIIterableResult;
import elemental2.core.JsIteratorIterable;
import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import jsinterop.annotations.JsMethod;
import jsinterop.annotations.JsType;

@JsType
public final class SimpleS2 {

  // These are the levels exposed to the client
  // Level 6 is the minimum because otherwise 47c4 is 7 MB with overview details.
  public static final int HIGHEST_OVERVIEW_INDEX_LEVEL = 6;
  public static final int HIGHEST_COARSE_INDEX_LEVEL = 7;
  // Level 12 is chosen because otherwise we pull in too many city streets in urban areas.
  public static final int HIGHEST_FINE_INDEX_LEVEL = 12;
  // This is the level at which the database gets indexed
  public static final int HIGHEST_INDEX_LEVEL = 13;

  @JsMethod
  public static int cellLevel(long id) {
    return S2CellId.MAX_LEVEL - (Long.numberOfTrailingZeros(id) >> 1);
  }

  @JsMethod
  public static ArrayList<S2CellId> cover(S2LatLngRect viewport, int deepest) {
    // Normalize the viewport for world wrapping. Note that at low zoom S2 has some weird S1Interval
    // logic that makes lo/hi the opposite of what we want. See also render_planner.ts#render.
    List<S2LatLngRect> expanded = new ArrayList<>();
    double lowLng = Math.min(viewport.lng().lo(), viewport.lng().hi());
    double highLng = Math.max(viewport.lng().lo(), viewport.lng().hi());
    if (lowLng == viewport.lng().lo()) {
      expanded.add(viewport);
    } else {
      expanded.add(
          new S2LatLngRect(
              viewport.lat(),
              new S1Interval(
                  Math.max(-Math.PI, lowLng),
                  Math.min(Math.PI, highLng))));
    }
    if (lowLng < -Math.PI) {
      expanded.add(
          new S2LatLngRect(
              viewport.lat(),
              new S1Interval(lowLng + 2 * Math.PI, 2 * Math.PI)));
    }
    if (highLng > Math.PI) {
      expanded.add(
          new S2LatLngRect(
              viewport.lat(),
              new S1Interval(-2 * Math.PI, highLng - 2 * Math.PI)));
    }

    // Then do the covering
    ArrayList<S2CellId> cells = new ArrayList<>();
    S2CellUnion union = new S2CellUnion();
    ArrayList<S2CellId> atLevel = new ArrayList<>();
    Set<S2CellId> seen = new HashSet<S2CellId>();
    for (int level = deepest; level >= 0; --level) {
      S2RegionCoverer coverer =
          S2RegionCoverer.builder().setMaxCells(1000).setMinLevel(level).setMaxLevel(level).build();
      for (S2LatLngRect view : expanded) {
        coverer.getCovering(view, union);
        union.expand(level);
        union.denormalize(level, /* levelMod= */ 1, atLevel);

        // Prematurely optimize this because it makes me scared
        if (expanded.size() > 1) {
          seen.addAll(atLevel);
        } else {
          cells.addAll(atLevel);
        }
      }
      if (expanded.size() > 1) {
        cells.addAll(seen);
        seen.clear();
      }
    }
    return cells;
  }

  @JsMethod
  public static S2Polygon decodePolygon(ArrayBuffer buffer) {
    try {
      return S2Polygon.decode(new ArrayBufferInputStream(buffer));
    } catch (IOException e) {
      throw new RuntimeException(e);
    }
  }

  @JsMethod
  public static S2LatLng pointToLatLng(S2Point point) {
    return new S2LatLng(point);
  }

  private static class ArrayBufferInputStream extends InputStream {

    private final JsIteratorIterable<Double> values;

    ArrayBufferInputStream(ArrayBuffer buffer) {
      values = new Uint8Array(buffer).values();
    }

    @Override
    public int read() {
      JsIIterableResult<Double> next = values.next();
      if (next.isDone()) {
        return -1;
      } else {
        return (int) (double) next.getValue();
      }
    }
  }
}
