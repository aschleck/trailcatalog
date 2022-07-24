export declare namespace com.google.common.geometry {

  class R1Interval {
    lo(): number;
    hi(): number;
  }

  class S1Angle {
    static degrees(n: number): S1Angle;
  }
  
  class S2CellId {
    id(): nativebootstrap.Long;
    level(): number;
    toToken(): string;
  }

  class S2LatLng {
    static fromDegrees(lat: number, lon: number): S2LatLng;
    static fromRadians(lat: number, lon: number): S2LatLng;
    equals(other: S2LatLng): boolean;
    latDegrees(): number;
    lngDegrees(): number;
    latRadians(): number;
    lngRadians(): number;
  }

  class S2LatLngRect {
    static fromPoint(point: S2LatLng): S2LatLngRect;
    static fromPointPair(p1: S2LatLng, p2: S2LatLng): S2LatLngRect;
    expandedByDistance(distance: S1Angle): S2LatLngRect;
    lo(): S2LatLng;
    hi(): S2LatLng;
    lat(): R1Interval;
    lng(): R1Interval;
  }

  class S2Loop {
    sign(): number;
    numVertices(): number;
    vertex(i: number): S2Point;
    vertices(): java.util.List<S2Point>;
  }

  class S2Point {
    getX(): number;
    getY(): number;
    getZ(): number;
  }

  class S2Polygon {
    containsPolygon(polygon: S2Polygon): boolean;
    getLoops(): java.util.List<S2Loop>;
    getRectBound(): S2LatLngRect;
    loop(k: number): S2Loop;
    numLoops(): number;
  }
}

export declare namespace java.util {
  class ArrayList<V> extends List<V> {
  }

  class List<V> {
    getAtIndex(i: number): V;
    size(): number;
  }
}

export declare namespace nativebootstrap {
  class Long {
    getHighBits(): number;
    getLowBits(): number;
  }
}

export declare namespace org.trailcatalog.s2 {
  class SimpleS2 {
    static HIGHEST_METADATA_INDEX_LEVEL: number;
    static HIGHEST_DETAIL_INDEX_LEVEL: number;
    static cellLevel(id: nativebootstrap.Long): number;
    static cover(viewport: com.google.common.geometry.S2LatLngRect, deepest: number):
        java.util.ArrayList<com.google.common.geometry.S2CellId>;
    static decodePolygon(bytes: ArrayBuffer): com.google.common.geometry.S2Polygon;
    static pointToLatLng(point: com.google.common.geometry.S2Point):
        com.google.common.geometry.S2LatLng;
  }
}

