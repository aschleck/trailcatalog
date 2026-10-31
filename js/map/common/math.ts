import { RgbaU32, TileId } from './types';

/**
 * Converts an rgba color in the range [0, 1] to an int.
 */
export function rgbaToUint32(r: number, g: number, b: number, a: number): RgbaU32 {
  return (((255 * r) << 24) | ((255 * g) << 16) | ((255 * b) << 8) | (255 * a)) as RgbaU32;
}

export function rgbaU32ToHex(color: RgbaU32): string {
  const r = ((color >> 24) & 0xff).toString(16).padStart(2, '0');
  const g = ((color >> 16) & 0xff).toString(16).padStart(2, '0');
  const b = ((color >> 8) & 0xff).toString(16).padStart(2, '0');
  const a = (color & 0xff).toString(16).padStart(2, '0');
  return `#${r}${g}${b}${a}`;
}

export function tilesIntersect(a: TileId, b: TileId): boolean {
  // This function works for tiles in normal (0-2^zoom) coordinates.
  if (a.zoom > b.zoom) {
    return tilesIntersect(b, a);
  }

  const dz = a.zoom - b.zoom;
  const p2 = Math.pow(2, dz);
  const bx = Math.floor(b.x * p2);
  const by = Math.floor(b.y * p2);
  return a.x === bx && a.y === by;
}

