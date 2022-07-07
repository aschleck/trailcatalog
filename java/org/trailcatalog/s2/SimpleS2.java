package org.trailcatalog.s2;

import static java.lang.StrictMath.max;

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
import jsinterop.annotations.JsMethod;
import jsinterop.annotations.JsType;

@JsType
public final class SimpleS2 {

  public static final int HIGHEST_METADATA_INDEX_LEVEL = 5;
  public static final int HIGHEST_DETAIL_INDEX_LEVEL = 10;
  public static final int HIGHEST_INDEX_LEVEL =
      max(HIGHEST_METADATA_INDEX_LEVEL, HIGHEST_DETAIL_INDEX_LEVEL);

  @JsMethod
  public static int cellLevel(long id) {
    return S2CellId.MAX_LEVEL - (Long.numberOfTrailingZeros(id) >> 1);
  }

  @JsMethod
  public static ArrayList<S2CellId> cover(S2LatLngRect viewport, int deepest) {
    ArrayList<S2CellId> cells = new ArrayList<>();
    S2CellUnion union = new S2CellUnion();
    ArrayList<S2CellId> atLevel = new ArrayList<>();
    for (int level = deepest; level >= 0; --level) {
      S2RegionCoverer coverer =
          S2RegionCoverer.builder().setMaxCells(1000).setMinLevel(level).setMaxLevel(level).build();
      coverer.getCovering(viewport, union);
      union.expand(level);
      union.denormalize(level, /* levelMod= */ 1, atLevel);
      cells.addAll(atLevel);
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
