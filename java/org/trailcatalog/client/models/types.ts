import { S2Polygon } from 'java/org/trailcatalog/s2';
import { LatLng, LatLngRect, Vec2 } from 'js/map/common/types';

import { PixelRect, s2LatLngRectToTc } from '../common/types';

export interface BoundaryLink {
  readonly id: bigint|string;
  readonly readableId: string;
  readonly name: string;
  readonly type: number;
}

export class Boundary {
  constructor(
      readonly id: bigint,
      readonly readableId: string,
      readonly name: string,
      readonly type: number,
      readonly polygon: S2Polygon,
  ) {}

  get bound(): LatLngRect {
    return s2LatLngRectToTc(this.polygon.getRectBound());
  }

  // Keep in sync with ExtractClimbingElements#nodeSiteId.
  get source(): {type: 'node'|'relation'|'way'; id: bigint} {
    if (this.id >= NODE_SITE_ID_OFFSET) {
      return {type: 'node', id: this.id - NODE_SITE_ID_OFFSET};
    } else if (this.id >= WAY_SITE_ID_OFFSET) {
      return {type: 'way', id: this.id - WAY_SITE_ID_OFFSET};
    } else {
      return {type: 'relation', id: this.id};
    }
  }
}

const WAY_SITE_ID_OFFSET = 1n << 40n;
const NODE_SITE_ID_OFFSET = 2n << 40n;

export class BoundarySearchResult {
  constructor(
      readonly id: bigint,
      readonly name: string,
      readonly type: number,
      readonly boundaries: BoundaryLink[],
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

  // Keep in sync with ExtractPoints.kt#nodePointId.
  get source(): {type: 'node'|'way'; id: bigint} {
    return {type: (this.id & 1n) === 0n ? 'node' : 'way', id: this.id >> 1n};
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

export interface TrailFact {
  predicate: string;
  value: boolean|number|object|string;
}

export class TrailSearchResult {
  constructor(
      readonly id: bigint,
      readonly readableId: string,
      readonly name: string,
      readonly bound: LatLngRect,
      readonly marker: LatLng,
      readonly elevationDownMeters: number,
      readonly elevationUpMeters: number,
      readonly lengthMeters: number,
      readonly boundaries: BoundaryLink[],
  ) {}
}

