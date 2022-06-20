import { LatLng, PixelRect, Vec2 } from '../common/types';

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
      readonly bound: PixelRect,
      readonly paths: bigint[],
      readonly center: LatLng,
      readonly centerPx: Vec2,
      readonly lengthMeters: number,
  ) {}

  get sourceRelation(): bigint {
    return this.id;
  }
}

