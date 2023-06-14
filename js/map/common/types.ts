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
  labels: Label[];
  waterways: Waterway[];

  geometry: Float64Array;
  indices: Uint32Array;
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
  vertexOffset: number;
  vertexLength: number;
}

export interface Contour {
  glacier: boolean;
  height: number;
  labelLength: number;
  labelOffset: number;
  nthLine: number;
  vertexLength: number;
  vertexOffset: number;
}

export enum HighwayType {
  Major,
  Arterial,
  Minor,
}

export interface Highway {
  type: HighwayType;
  vertexLength: number;
  vertexOffset: number;
}

export interface Label {
  type: LabelType;
  positionOffset: number;
  rank: number;
  text: string;
}

export enum LabelType {
  City,
  Continent,
  Country,
  Island,
  NationalForest,
  NationalPark,
  Peak,
  Province,
  Region,
  State,
  Town,
  Village,
}

export interface Polygon {
  indexLength: number;
  indexOffset: number;
  vertexLength: number;
  vertexOffset: number;
}

export interface Waterway {
  type: 'river';
  vertexLength: number;
  vertexOffset: number;
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

