import { S2Polygon } from 'java/org/trailcatalog/s2';

import { LatLng, LatLngRect, PixelRect, Vec2 } from '../common/types';

export class Boundary {
  constructor(
      readonly id: bigint,
      readonly name: string,
      readonly type: number,
      readonly polygon: S2Polygon,
  ) {}

  get sourceRelation(): bigint {
    return this.id;
  }
}

export class Path {
  constructor(
      readonly id: bigint,
      readonly type: number,
      readonly bound: PixelRect,
      readonly line: Float32Array|Float64Array,
  ) {}
}

export class Trail {
  constructor(
      readonly id: bigint,
      readonly name: string,
      readonly type: number,
      readonly mouseBound: PixelRect,
      readonly paths: bigint[],
      public bound: LatLngRect,
      readonly marker: LatLng,
      readonly markerPx: Vec2,
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
      readonly marker: LatLng,
      readonly lengthMeters: number,
  ) {}
}

