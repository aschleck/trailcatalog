export type S2CellNumber = number & {brand: 'S2CellNumber'};

export type Vec2 = [number, number];
export type Vec4 = [number, number, number, number];

export interface PixelRect {
  low: Vec2;
  high: Vec2;
};

export interface TileId {
  x: number;
  y: number;
  zoom: number;
}

