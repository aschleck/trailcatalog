package org.trailcatalog.s2;

import com.google.common.collect.ImmutableSet;
import com.google.common.geometry.R1Interval;
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
import com.google.common.geometry.S2Projections;
import com.google.common.geometry.S2RegionCoverer;
import elemental2.core.ArrayBuffer;
import elemental2.core.Uint8Array;
import elemental2.core.JsIIterableResult;
import elemental2.core.JsIteratorIterable;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Arrays;
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

  /** The furthest a point can move when snapped to a level {@code level} cell, in radians. */
  @JsMethod
  public static double snapRadians(int level) {
    // Half a diagonal, because a point can land anywhere in the cell it snapped to.
    return S2Projections.MAX_DIAG.getValue(level) / 2.0;
  }

  /** {@link #snapRadians} in the Mercator units the simplifier measures in. */
  @JsMethod
  public static double snapEpsilon(int level) {
    // A Mercator unit is 180 degrees of longitude, so pi radians.
    return snapRadians(level) / Math.PI;
  }

  /**
   * Returns which vertices of an interleaved x,y polyline Douglas-Peucker keeps, dropping any
   * vertex within epsilon of the chord across it. A vertex pinned is true for survives regardless
   * of epsilon, and pinned may be null.
   */
  @JsMethod
  public static boolean[] douglasPeucker(double[] xys, double epsilon, boolean[] pinned) {
    int pointCount = xys.length / 2;
    boolean[] keep = new boolean[pointCount];
    if (pointCount < 3) {
      Arrays.fill(keep, true);
      return keep;
    }

    keep[0] = true;
    keep[pointCount - 1] = true;
    // Spans are start then end vertex, flattened so J2CL needs no boxing
    ArrayDeque<Integer> spans = new ArrayDeque<>();
    int spanStart = 0;
    for (int i = 1; i < pointCount; ++i) {
      if (i == pointCount - 1 || (pinned != null && pinned[i])) {
        keep[i] = true;
        spans.push(spanStart);
        spans.push(i);
        spanStart = i;
      }
    }
    while (!spans.isEmpty()) {
      int endI = spans.pop();
      int startI = spans.pop();
      if (endI <= startI + 1) {
        continue;
      }

      double startX = xys[2 * startI];
      double startY = xys[2 * startI + 1];
      double dx = xys[2 * endI] - startX;
      double dy = xys[2 * endI + 1] - startY;
      double lengthSquared = dx * dx + dy * dy;

      double biggest = 0;
      int furthest = -1;
      for (int i = startI + 1; i < endI; ++i) {
        double px = xys[2 * i] - startX;
        double py = xys[2 * i + 1] - startY;
        // Measure to the segment, not to the infinite line through it, so that epsilon really
        // bounds how far the result moves. A vertex past either end is further from the polyline
        // we hand back than its perpendicular says. Clamping t to zero also handles a closed span,
        // which has no direction, by measuring from its ends.
        double t =
            lengthSquared > 0
                ? Math.max(0, Math.min(1, (px * dx + py * dy) / lengthSquared))
                : 0;
        double ex = px - t * dx;
        double ey = py - t * dy;
        double distance = Math.sqrt(ex * ex + ey * ey);
        if (distance > biggest) {
          biggest = distance;
          furthest = i;
        }
      }

      // Keep the split point in both halves, or else a vertex that the chord across it does clear
      // gets dropped along with the ones it was standing in for.
      if (furthest > -1 && biggest > epsilon) {
        keep[furthest] = true;
        spans.push(startI);
        spans.push(furthest);
        spans.push(furthest);
        spans.push(endI);
      }
    }
    return keep;
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

  /**
   * Takes bare radians instead of an S2LatLngRect because callers pass coordinates outside of
   * [-pi, pi] and S2LatLngRect rejects them.
   */
  @JsMethod
  public static ArrayList<S2CellId> cover(
      double latLo, double latHi, double lngLo, double lngHi, int deepest) {
    // Callers unpacking an S2LatLngRect give us lo/hi swapped once the span passes pi, because
    // that's how fromPointPair stores it. See also render_planner.ts#render.
    double lowLng = Math.min(lngLo, lngHi);
    double highLng = Math.max(lngLo, lngHi);
    R1Interval lat = R1Interval.fromPointPair(latLo, latHi);

    // Shift the range into [-pi, pi] and split it where it runs off the end.
    List<S2LatLngRect> expanded = new ArrayList<>();
    if (highLng - lowLng >= 2 * Math.PI) {
      expanded.add(new S2LatLngRect(lat, S1Interval.full()));
    } else {
      double worlds = Math.floor((lowLng + Math.PI) / (2 * Math.PI));
      lowLng -= worlds * 2 * Math.PI;
      highLng -= worlds * 2 * Math.PI;
      expanded.add(
          new S2LatLngRect(
              lat, new S1Interval(lowLng, Math.min(Math.PI, highLng))));
      if (highLng > Math.PI) {
        expanded.add(
            new S2LatLngRect(
                lat, new S1Interval(-Math.PI, highLng - 2 * Math.PI)));
      }
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
