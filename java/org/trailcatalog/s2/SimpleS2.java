package org.trailcatalog.s2;

import com.google.common.collect.ImmutableSet;
import com.google.common.geometry.S1Angle;
import com.google.common.geometry.S1Interval;
import com.google.common.geometry.S2Cell;
import com.google.common.geometry.S2CellId;
import com.google.common.geometry.S2CellUnion;
import com.google.common.geometry.S2LatLng;
import com.google.common.geometry.S2LatLngRect;
import com.google.common.geometry.S2Loop;
import com.google.common.geometry.S2Point;
import com.google.common.geometry.S2Polygon;
import com.google.common.geometry.S2RegionCoverer;
import elemental2.core.ArrayBuffer;
import elemental2.core.Uint8Array;
import elemental2.core.JsIIterableResult;
import elemental2.core.JsIteratorIterable;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import jsinterop.annotations.JsMethod;
import jsinterop.annotations.JsType;
import jsinterop.base.Js;
import jsinterop.base.JsArrayLike;

@JsType
public final class SimpleS2 {

  public static final int EARTH_RADIUS_METERS = 6371010;

  // These are the levels exposed to the client as the highest level of the index. They must be kept
  // equal between the two, or else they will give each other wrong data in the leaves.

  // Level 6 is the minimum because otherwise 47c4 is 7 MB with overview details.
  // Level 7 is a better minimum because otherwise the client slows down
  public static final int HIGHEST_OVERVIEW_INDEX_LEVEL = 7;
  // Level 8 is the minimum because otherwise 47b94 is 3 MB with coarse details.
  public static final int HIGHEST_COARSE_INDEX_LEVEL = 8;
  // Level 10 is chosen because we can.
  // If we allow pulling streets, level 12 is best because otherwise we pull in too many city
  // streets in urban areas.
  public static final int HIGHEST_FINE_INDEX_LEVEL = 10;
  // This is the level at which the database gets indexed
  public static final int HIGHEST_INDEX_LEVEL = 13;

  @JsMethod
  public static double angleToEarthMeters(S1Angle angle) {
    return angle.radians() * EARTH_RADIUS_METERS;
  }

  @JsMethod
  public static S2Cell cellIdToCell(S2CellId id) {
    return new S2Cell(id);
  }

  @JsMethod
  public static int cellLevel(long id) {
    return S2CellId.MAX_LEVEL - (Long.numberOfTrailingZeros(id) >> 1);
  }

  @JsMethod
  public static S1Angle earthMetersToAngle(double meters) {
    return S1Angle.radians(meters / EARTH_RADIUS_METERS);
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

    // Compute the base covering cells
    S2RegionCoverer coverer =
        S2RegionCoverer.builder()
            .setMaxCells(1000)
            .setMinLevel(deepest)
            .setMaxLevel(deepest)
            .build();
    Set<S2CellId> base = new HashSet<>();
    S2CellUnion union = new S2CellUnion();
    ArrayList<S2CellId> cells = new ArrayList<>();
    for (S2LatLngRect view : expanded) {
      coverer.getCovering(view, union);
      union.expand(deepest);
      union.denormalize(deepest, /* levelMod= */ 1, cells);
      base.addAll(cells);
    }

    // Now come up the hierarchy
    ImmutableSet.Builder<S2CellId> all = ImmutableSet.builder(); // for insertion iteration order
    all.addAll(base);
    for (int level = deepest - 1; level >= 0; --level) {
      for (S2CellId cell : base) {
        all.add(cell.parent(level));
      }
    }
    return new ArrayList<>(all.build());
  }

  @JsMethod
  public static S2CellUnion decodeCellUnion(Uint8Array array) {
    try {
      return S2CellUnion.decode(new ByteArrayInputStream(Js.uncheckedCast(array)));
    } catch (IOException e) {
      throw new RuntimeException("Unable to decode covering", e);
    }
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
  public static ArrayBuffer encodePolygon(S2Polygon polygon) {
    try {
      ByteArrayOutputStream stream = new ByteArrayOutputStream();
      polygon.encode(stream);
      return Uint8Array.from(Js.<JsArrayLike<Double>>uncheckedCast(stream.toByteArray())).buffer;
    } catch (IOException e) {
      throw new RuntimeException(e);
    }
  }

  @JsMethod
  public static S2LatLng pointToLatLng(S2Point point) {
    return new S2LatLng(point);
  }

  @JsMethod
  public static S2Polygon pointsToPolygon(ArrayList<S2Point> points) {
    return new S2Polygon(new S2Loop(points));
  }

  @JsMethod
  public static <E> ArrayList<E> newArrayList() {
    // Not sure why we can't just do `new ArrayList<E>()` in JS but the constructor isn't compiled.
    return new ArrayList<>();
  }

  @JsMethod
  public static S2Polygon newPolygon() {
    return new S2Polygon();
  }

  private static class ArrayBufferInputStream extends InputStream {

    // TODO(april): Is this solution better? https://stackoverflow.com/a/75393795

    private final JsIteratorIterable<Double, Object, Object> values;

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
