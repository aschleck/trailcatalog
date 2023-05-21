import { LatLngRect, LatLngZoom, RgbaU32, TileId, Vec2, Vec4 } from './types';

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

export function screenLlz(bound: LatLngRect, screen: DOMRect): LatLngZoom {
  const dLL = [
    bound.high[0] - bound.low[0],
    bound.high[1] - bound.low[1],
  ];
  const center = [
    bound.low[0] + dLL[0] / 2,
    bound.low[1] + dLL[1] / 2,
  ];

  // Bounds on the antimeridian appear to span the entire world, so correct them.
  if (bound.high[1] < bound.low[1]) {
    dLL[1] += 360;
    center[1] = (bound.low[1] + dLL[1] / 2 + 180) % 360 - 180;
  }

  // Ideal fit: screen / (256 * 2^zoom) = dLL[0] / 360
  // => 2^zoom = screen / 256 / (dLL[0] / 360)
  // => zoom = log(screen / 256 / (dLL[0] / 360)) / log(2)
  const zoom =
      Math.min(
              Math.log(screen.width / 256 / (dLL[1] / 360)),
              Math.log(screen.height / 256 / (dLL[0] / 180)))
          / Math.log(2);
  return {lat: center[0], lng: center[1], zoom};
}

export function splitVec2(v: Vec2): Vec4 {
  const x = v[0];
  const xF = Math.fround(x);
  const y = v[1];
  const yF = Math.fround(y);
  return [xF, x - xF, yF, y - yF];
}

export function tilesIntersect(a: TileId, b: TileId): boolean {
  if (a.zoom > b.zoom) {
    return tilesIntersect(b, a);
  }

  const dz = a.zoom - b.zoom;
  const p2 = Math.pow(2, dz);
  const bx = Math.floor(b.x * p2);
  const by = Math.ceil(b.y * p2);
  return a.x === bx && a.y === by;
}

