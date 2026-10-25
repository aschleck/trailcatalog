import { ArrayList, S1Angle, S2CellId }
    from 'external/com_google_geometry_s2+/js/documented/index.js';

export * from 'external/com_google_geometry_s2+/js/documented/index.js';

export class SimpleS2 {
  private constructor();
  static EARTH_RADIUS_METERS: number;
  static HIGHEST_OVERVIEW_INDEX_LEVEL: number;
  static HIGHEST_COARSE_INDEX_LEVEL: number;
  static HIGHEST_FINE_INDEX_LEVEL: number;
  static angleToEarthMeters(angle: S1Angle): number;
  static cover(latLo: number, latHi: number, lngLo: number, lngHi: number, deepest: number):
      ArrayList<S2CellId>;
  static douglasPeucker(xys: ArrayLike<number>, epsilon: number, pinned: boolean[]|null):
      boolean[];
  static earthMetersToAngle(meters: number): S1Angle;
  static snapEpsilon(level: number): number;
  static snapRadians(level: number): number;
}
