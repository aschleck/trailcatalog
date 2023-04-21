export type LatLng = Vec2 & {brand: 'LatLng'};

export type LatLngRect = {
  low: Vec2;
  high: Vec2;
} & {brand: 'LatLngRect'};

export function emptyLatLngRect(): LatLngRect {
  return {
    low: [90, 180],
    high: [-90, -180],
    brand: 'LatLngRect',
  };
}

export type LatLngZoom = {
  lat: number;
  lng: number;
  zoom: number;
};

export type RgbaU32 = number & {brand: 'RgbaU32'};

export interface TileId {
  x: number;
  y: number;
  zoom: number;
};

export interface BitmapTileset {
  type: 'bitmap';
  extraZoom: number; // some tiles are at 2x resolution, meaning -1
  minZoom: number;
  maxZoom: number;
  tileUrl: string;
}

export interface MbtileTileset {
  type: 'mbtile';
  extraZoom: number; // some tiles are at 2x resolution, meaning -1
  minZoom: number;
  maxZoom: number;
  tileUrl: string;
}

export type Tileset = BitmapTileset|MbtileTileset;

export interface MbtileTile {
  areas: Area[];
  boundaries: Boundary[];
  contoursFt: Contour[];
  contoursM: Contour[];
  highways: Highway[];
  waterways: Waterway[];
}

export enum AreaType {
  GlobalLandcoverCrop,
  GlobalLandcoverForest,
  GlobalLandcoverGrass,
  GlobalLandcoverScrub,
  LandcoverGrass,
  LandcoverIce,
  LandcoverSand,
  LandcoverWood,
  LanduseHuman,
  Park,
  Transportation,
  Water,
}

export interface Area {
  type: AreaType;
  polygons: Polygon[];
  priority: number;
}

export interface Boundary {
  adminLevel: number;
  vertices: Float64Array;
}

export interface Contour {
  height: number;
  labels: Label[];
  nthLine: number;
  vertices: Float64Array;
}

export enum HighwayType {
  Major,
  Arterial,
  Minor,
}

export interface Highway {
  type: HighwayType;
  vertices: Float64Array;
}

export interface Polygon {
  indices: number[];
  vertices: Float64Array;
}

export interface Waterway {
  type: 'river';
  vertices: Float64Array;
}

export interface Label {
  angle: number;
  position: Vec2;
}

export type Vec2 = [number, number];
export type Vec4 = [number, number, number, number];

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

