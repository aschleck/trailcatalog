import { checkExhaustive } from 'external/dev_april_corgi+/js/common/asserts';

// Mapterhorn serves terrarium encoded WebP tiles, 512 pixels to a side, at z12 everywhere it has
// land and deeper where a finer source covers the area.
// https://mapterhorn.com/attribution
const TILE_URL = 'https://tiles.mapterhorn.com/${z}/${x}/${y}.webp';
const TILE_SIZE = 512;
// Everywhere with data has z12, so a missing tile there is ocean rather than coarser coverage.
const BASE_ZOOM = 12;
// Terrarium packs meters as r * 256 + g + b / 256 - 32768.
const TERRARIUM_OFFSET = 32768;
// Each tile decodes to a megabyte of floats, and a long measurement reaches a few dozen.
const TILE_CACHE_SIZE = 48;

interface InitializeRequest {
  kind: 'ir';
}

export interface SampleRequest {
  kind: 'sr';
  id: number;
  // Interleaved lat then lng, in degrees
  latLngDegrees: Float64Array;
  zoom: number;
}

export type Request = InitializeRequest|SampleRequest;

export interface SampleResponse {
  kind: 'sr';
  id: number;
  // One per point, 0 where there is no data, which is what CalculateWayElevations assumes too.
  // Empty when sampling failed.
  meters: Float32Array;
}

export type Response = SampleResponse;

type Tile = Float32Array|undefined;

/** Samples Mapterhorn elevations with bilinear interpolation between pixel centers. */
class ElevationSampler {

  // By z/x/y, oldest first, so that trimming drops the tile used longest ago
  private readonly tiles: Map<string, Promise<Tile>>;

  constructor(
      private readonly postMessage: (response: Response, transfer?: Transferable[]) => void,
  ) {
    this.tiles = new Map();
  }

  async sample(request: SampleRequest): Promise<void> {
    const count = request.latLngDegrees.length / 2;
    const meters = new Float32Array(count);
    for (let i = 0; i < count; ++i) {
      meters[i] =
          await this.sampleAt(
              request.latLngDegrees[2 * i], request.latLngDegrees[2 * i + 1], request.zoom);
    }
    this.postMessage({kind: 'sr', id: request.id, meters}, [meters.buffer]);
  }

  fail(request: SampleRequest): void {
    this.postMessage({kind: 'sr', id: request.id, meters: new Float32Array(0)});
  }

  // Falls back a zoom at a time until a tile answers, because only some places are covered past
  // BASE_ZOOM.
  private async sampleAt(lat: number, lng: number, zoom: number): Promise<number> {
    for (let z = zoom; z >= BASE_ZOOM; --z) {
      const value = await this.bilinear(lat, lng, z);
      if (value !== undefined) {
        return value;
      }
    }
    return 0;
  }

  private async bilinear(lat: number, lng: number, z: number): Promise<number|undefined> {
    const world = TILE_SIZE * Math.pow(2, z);
    const sin = Math.sin(lat * Math.PI / 180);
    // Minus half a pixel because a pixel's value sits at its center
    const px = (lng + 180) / 360 * world - 0.5;
    const py = (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * world - 0.5;
    const x0 = Math.floor(px);
    const y0 = Math.floor(py);
    const fx = px - x0;
    const fy = py - y0;

    const corners = [];
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      const value = await this.pixel(z, x0 + dx, y0 + dy, world);
      if (value === undefined) {
        return undefined;
      }
      corners.push(value);
    }
    const top = corners[0] * (1 - fx) + corners[1] * fx;
    const bottom = corners[2] * (1 - fx) + corners[3] * fx;
    return top * (1 - fy) + bottom * fy;
  }

  private async pixel(z: number, x: number, y: number, world: number): Promise<number|undefined> {
    const wrappedX = ((x % world) + world) % world;
    const clampedY = Math.min(Math.max(y, 0), world - 1);
    const tile =
        await this.tile(
            z, Math.floor(wrappedX / TILE_SIZE), Math.floor(clampedY / TILE_SIZE));
    return tile?.[(clampedY % TILE_SIZE) * TILE_SIZE + (wrappedX % TILE_SIZE)];
  }

  private tile(z: number, x: number, y: number): Promise<Tile> {
    const key = `${z}/${x}/${y}`;
    const cached = this.tiles.get(key);
    if (cached) {
      this.tiles.delete(key);
      this.tiles.set(key, cached);
      return cached;
    }

    const loading = decode(z, x, y);
    // A fetch that failed is worth trying again, unlike a 404, which decode answers as undefined.
    loading.catch(() => {
      this.tiles.delete(key);
    });
    this.tiles.set(key, loading);
    while (this.tiles.size > TILE_CACHE_SIZE) {
      this.tiles.delete(this.tiles.keys().next().value!);
    }
    return loading;
  }
}

// Decodes without color management or premultiplying, either of which would shift the channels
// and so the meters they encode.
async function decode(z: number, x: number, y: number): Promise<Tile> {
  const url =
      TILE_URL.replace('${z}', String(z)).replace('${x}', String(x)).replace('${y}', String(y));
  const response = await fetch(url);
  if (!response.ok) {
    return undefined;
  }

  const bitmap =
      await createImageBitmap(
          await response.blob(), {colorSpaceConversion: 'none', premultiplyAlpha: 'none'});
  const canvas = new OffscreenCanvas(TILE_SIZE, TILE_SIZE);
  const context = canvas.getContext('2d', {willReadFrequently: true})!;
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  const rgba = context.getImageData(0, 0, TILE_SIZE, TILE_SIZE).data;
  const meters = new Float32Array(TILE_SIZE * TILE_SIZE);
  for (let i = 0; i < meters.length; ++i) {
    meters[i] = rgba[4 * i] * 256 + rgba[4 * i + 1] + rgba[4 * i + 2] / 256 - TERRARIUM_OFFSET;
  }
  return meters;
}

// Answers requests one at a time, in order, so that tiles a request loads are cached for the next.
let queue = Promise.resolve();
const sampler = new ElevationSampler((self as any).postMessage.bind(self));
self.onmessage = e => {
  const request = e.data as Request;
  if (request.kind === 'ir') {
    // nothing to set up
  } else if (request.kind === 'sr') {
    queue = queue.then(() => sampler.sample(request)).catch(e => {
      console.error(e);
      sampler.fail(request);
    });
  } else {
    checkExhaustive(request);
  }
};
