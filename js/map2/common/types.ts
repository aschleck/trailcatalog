export interface Copyright {
  long: string;
  short?: string;
  url?: string;
}

export type Vec2 = Readonly<[number, number]>;
export type Vec4 = Readonly<[number, number, number, number]>;

export type Rect = Readonly<{
  low: Vec2;
  high: Vec2;
}>;

export type LatLng = Vec2 & {brand: 'LatLng'}; // in degrees, not radians
export type LatLngRect = Rect & {brand: 'LatLngRect'}; // in degrees, not radians

export type LatLngZoom = Readonly<{
  lat: number;
  lng: number;
  zoom: number;
}>;

export type RgbaU32 = number & {brand: 'RgbaU32'};

export type TileId = Readonly<{
  x: number;
  y: number;
  zoom: number;
}>;

export type S2CellToken = string & {brand: 'S2CellToken'};
