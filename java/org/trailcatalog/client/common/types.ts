// A LatLng is a pair of *degrees*.
export type S2CellNumber = number & {brand: 'S2CellNumber'};
export type Vec2 = [number, number];
export type Vec4 = [number, number, number, number];

export type LatLng = Vec2 & {brand: 'LatLng'};
export type Rgba32F = number & {brand: 'Rgba32F'};

export type LatLngRect = {
  low: Vec2;
  high: Vec2;
} & {brand: 'LatLngRect'};

export type LatLngZoom = {
  lat: number;
  lng: number;
  zoom: number;
};

export type PixelRect = {
  low: Vec2;
  high: Vec2;
} & {brand: 'PixelRect'};

export interface TileId {
  x: number;
  y: number;
  zoom: number;
};

