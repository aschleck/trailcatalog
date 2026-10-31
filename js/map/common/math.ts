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

/**
 * Returns the most detailed tile under the mercator point, with where the point falls in it as
 * fractions of the tile across from its west edge and down from its north edge.
 */
export function finestTileAt<V>(tiles: Iterable<[TileId, V]>, x: number, y: number):
    {id: TileId; value: V; u: number; v: number}|undefined {
  let best: {id: TileId; value: V; u: number; v: number}|undefined = undefined;
  for (const [id, value] of tiles) {
    if (best && best.id.zoom >= id.zoom) {
      continue;
    }

    const size = 2 ** id.zoom;
    const u = (x + 1) / 2 * size - id.x;
    const v = (1 - y) / 2 * size - id.y;
    if (0 <= u && u < 1 && 0 <= v && v < 1) {
      best = {id, value, u, v};
    }
  }
  return best;
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

