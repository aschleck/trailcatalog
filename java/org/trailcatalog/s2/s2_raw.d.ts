export declare namespace com.google.common.geometry {

  class R1Interval {
    lo(): number;
    hi(): number;
  }

  class S1Angle {
    static degrees(n: number): S1Angle;
    radians(): number;
  }
  
  class S2Cell {
    exactArea(): number;
  }

  class S2CellId {
    static fromLatLng(ll: S2LatLng): S2CellId;
    static fromPoint(p: S2Point): S2CellId;
    static fromToken(token: string): S2CellId;
    constructor(id: nativebootstrap.Long);
    id(): nativebootstrap.Long;
    level(): number;
    parentAtLevel(level: number): S2CellId;
    rangeMax(): S2CellId;
    rangeMin(): S2CellId;
    toLoop(level: number): S2Loop;
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
    toPoint(): S2Point;
  }

  class S2LatLngRect {
    static fromPoint(point: S2LatLng): S2LatLngRect;
    static fromPointPair(p1: S2LatLng, p2: S2LatLng): S2LatLngRect;
    area(): number;
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
    add(p: S2Point): S2Point;
    angle(p: S2Point): number;
    div(scale: number): S2Point;
    mul(scale: number): S2Point;
    sub(p: S2Point): S2Point;
    getX(): number;
    getY(): number;
    getZ(): number;
  }

  class S2Polygon {
    contains(polygon: S2Polygon): boolean;
    getArea(): number;
    getLoops(): java.util.List<S2Loop>;
    getRectBound(): S2LatLngRect;
    loop(k: number): S2Loop;
    numLoops(): number;
  }

  //class S2PolygonBuilder {
  //  constructor(options: S2PolygonBuilderOptions);
  //  addEdge(v0: S2Point, v1: S2Point): boolean;
  //  getPolygon(): S2Polygon;
  //}

  //class S2PolygonBuilderOptions {
  //  static DIRECTED_UNION: S2PolygonBuilderOptions;
  //  static DIRECTED_XOR: S2PolygonBuilderOptions;
  //  static UNDIRECTED_UNION: S2PolygonBuilderOptions;
  //  static UNDIRECTED_XOR: S2PolygonBuilderOptions;
  //}
}

export declare namespace java.util {
  class ArrayList<E> extends List<E> {
  }

  class List<E> {
    getAtIndex(i: number): E;
    size(): number;
  }
}

export declare namespace nativebootstrap {
  class Long {
    static fromBits(low: number, high: number): Long;
    static fromString(str: string, opt_radix?: number): Long;
    getHighBits(): number;
    getLowBits(): number;
    toString(radix?: number): string;
  }
}

export declare namespace org.trailcatalog.s2 {
  class SimpleS2 {
    static EARTH_RADIUS_METERS: number;
    static HIGHEST_OVERVIEW_INDEX_LEVEL: number;
    static HIGHEST_COARSE_INDEX_LEVEL: number;
    static HIGHEST_FINE_INDEX_LEVEL: number;
    static angleToEarthMeters(angle: com.google.common.geometry.S1Angle): number;
    static cellIdToCell(id: com.google.common.geometry.S2CellId): com.google.common.geometry.S2Cell;
    static cellLevel(id: nativebootstrap.Long): number;
    static cover(viewport: com.google.common.geometry.S2LatLngRect, deepest: number):
        java.util.ArrayList<com.google.common.geometry.S2CellId>;
    static decodePolygon(bytes: ArrayBuffer): com.google.common.geometry.S2Polygon;
    static earthMetersToAngle(meters: number): com.google.common.geometry.S1Angle;
    static pointToLatLng(point: com.google.common.geometry.S2Point):
        com.google.common.geometry.S2LatLng;
  }
}

