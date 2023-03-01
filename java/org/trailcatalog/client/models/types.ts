import { S2Polygon } from 'java/org/trailcatalog/s2';

import { LatLng, LatLngRect, PixelRect, s2LatLngRectToTc, Vec2 } from '../common/types';

export class Boundary {
  constructor(
      readonly id: bigint,
      readonly name: string,
      readonly type: number,
      readonly polygon: S2Polygon,
  ) {}

  get bound(): LatLngRect {
    return s2LatLngRectToTc(this.polygon.getRectBound());
  }

  get sourceRelation(): bigint {
    return this.id;
  }
}

export class BoundarySearchResult {
  constructor(
      readonly id: bigint,
      readonly name: string,
      readonly type: number,
      readonly boundaries: Array<{
        id: string;
        name: string;
        type: number;
      }>,
  ) {}
}

export class ElevationProfile {
  constructor(
      readonly granularityMeters: number,
      readonly samplesMeters: number[],
  ) {}
}

export class Path {
  constructor(
      readonly id: bigint,
      readonly type: number,
      readonly bound: PixelRect,
      readonly line: Float32Array|Float64Array,
  ) {}

  get sourceWay(): bigint {
    return this.id / 2n;
  }
}

export class Point {
  constructor(
      readonly id: bigint,
      readonly type: number,
      readonly name: string|undefined,
      readonly markerPx: Vec2,
      readonly mouseBound: PixelRect,
  ) {}

  get sourceNode(): bigint {
    return this.id;
  }
}

export class Trail {
  constructor(
      readonly id: bigint,
      // When loading trails for viewport, we don't fetch readable IDs. Not sure if good or bad.
      readonly readableId: string|undefined,
      readonly name: string,
      readonly type: number,
      readonly mouseBound: PixelRect,
      readonly paths: bigint[],
      public bound: LatLngRect,
      readonly marker: LatLng,
      readonly markerPx: Vec2,
      readonly elevationDownMeters: number,
      readonly elevationUpMeters: number,
      readonly lengthMeters: number,
  ) {}

  get sourceRelation(): bigint {
    return this.id;
  }
}

export class TrailSearchResult {
  constructor(
      readonly id: bigint,
      readonly name: string,
      readonly bound: LatLngRect,
      readonly marker: LatLng,
      readonly elevationDownMeters: number,
      readonly elevationUpMeters: number,
      readonly lengthMeters: number,
      readonly boundaries: Array<{
        id: string;
        name: string;
        type: number;
      }>,
  ) {}
}

