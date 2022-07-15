import { S2LatLngRect, S2Polygon } from 'java/org/trailcatalog/s2';
import { SimpleS2 } from 'java/org/trailcatalog/s2/SimpleS2';

// A LatLng is a pair of *degrees*.
export type S2CellNumber = number & {brand: 'S2CellNumber'};
export type Vec2 = [number, number];
export type Vec4 = [number, number, number, number];

export type LatLng = Vec2 & {brand: 'LatLng'};
export type RgbaU32 = number & {brand: 'RgbaU32'};

export type LatLngRect = {
  low: Vec2;
  high: Vec2;
} & {brand: 'LatLngRect'};

export function emptyLatLngRect(): LatLngRect {
  return {
    low: [0, 0],
    high: [0, 0],
    brand: 'LatLngRect',
  };
}

export type LatLngZoom = {
  lat: number;
  lng: number;
  zoom: number;
};

export type PixelRect = {
  low: Vec2;
  high: Vec2;
} & {brand: 'PixelRect'};

export function emptyPixelRect(): PixelRect {
  return {
    low: [0, 0],
    high: [0, 0],
    brand: 'PixelRect',
  };
}

export interface TileId {
  x: number;
  y: number;
  zoom: number;
};

export function s2LatLngRectToTc(rect: S2LatLngRect): LatLngRect {
  const lo = rect.lo();
  const hi = rect.hi();
  return {
    low: [lo.latDegrees(), lo.lngDegrees()],
    high: [hi.latDegrees(), hi.lngDegrees()],
    brand: 'LatLngRect',
  };
}

const EMPTY_POLYGON = 
    SimpleS2.decodePolygon(Uint8Array.from([
      /* compressed= */ 4,
      /* level= */ 1,
      /* numLoops= */ 0,
    ]).buffer);

export function emptyS2Polygon(): S2Polygon {
  return EMPTY_POLYGON;
}
