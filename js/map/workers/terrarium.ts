import { TileId } from '../common/types';

// Mapterhorn serves terrarium encoded WebP tiles, 512 pixels to a side, at z12 everywhere it has
// land and deeper where a finer source covers the area.
// https://mapterhorn.com/attribution
export const TILE_URL = 'https://tiles.mapterhorn.com/${id.zoom}/${id.x}/${id.y}.webp';
export const TILE_SIZE = 512;
// Everywhere with data has z12, so a missing tile there is ocean rather than coarser coverage.
export const BASE_ZOOM = 12;
// Terrarium packs meters as r * 256 + g + b / 256 - 32768.
const TERRARIUM_OFFSET = 32768;

export function tileUrl(id: TileId): string {
  return TILE_URL
      .replace('${id.zoom}', String(id.zoom))
      .replace('${id.x}', String(id.x))
      .replace('${id.y}', String(id.y));
}

/** Fetches and decodes a tile into meters, or undefined when Mapterhorn has no tile there. */
export async function fetchTerrarium(id: TileId): Promise<Float32Array|undefined> {
  const response = await fetch(tileUrl(id));
  if (!response.ok) {
    return undefined;
  }
  return decodeTerrarium(await response.blob());
}

/** Converts a terrarium pixel's 24 packed RGB bits to meters. */
export function terrariumMeters(packed: number): number {
  return packed / 256 - TERRARIUM_OFFSET;
}

export async function decodeTerrarium(blob: Blob): Promise<Float32Array> {
  const rgba = await readTerrarium(blob);
  const meters = new Float32Array(TILE_SIZE * TILE_SIZE);
  for (let i = 0; i < meters.length; ++i) {
    meters[i] = rgba[4 * i] * 256 + rgba[4 * i + 1] + rgba[4 * i + 2] / 256 - TERRARIUM_OFFSET;
  }
  return meters;
}

// Decodes without color management or premultiplying, either of which would shift the channels
// and so the meters they encode.
export async function readTerrarium(blob: Blob): Promise<Uint8ClampedArray> {
  const bitmap =
      await createImageBitmap(blob, {colorSpaceConversion: 'none', premultiplyAlpha: 'none'});
  const canvas = new OffscreenCanvas(TILE_SIZE, TILE_SIZE);
  const context = canvas.getContext('2d', {willReadFrequently: true})!;
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  return context.getImageData(0, 0, TILE_SIZE, TILE_SIZE).data;
}
