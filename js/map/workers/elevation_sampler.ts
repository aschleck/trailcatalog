import { checkExhaustive } from 'external/dev_april_corgi+/js/common/asserts';

import { Vec2 } from '../common/types';

import { BASE_ZOOM, fetchTerrarium, TILE_SIZE } from './terrarium';
import { GradeLimits, routeOverTerrain, simplifyCells } from './terrain_router';

// Each tile decodes to a megabyte of floats, and a long measurement reaches a few dozen.
const TILE_CACHE_SIZE = 48;
// Keep in sync with SimpleS2#EARTH_RADIUS_METERS
const EARTH_RADIUS_METERS = 6371010;
// A z12 cell is 13 m across in the Alps, so a million cells is a box 13 km on a side. The search
// holds 16 bytes a cell plus 16 per heap entry, and a longer segment drops a zoom rather than grow
// past this.
const MAX_ROUTE_CELLS = 1 << 20;
// Past z9 cells are over 100 m across, which walks straight through cliff bands.
const MIN_ROUTE_ZOOM = 9;
// How far past the box around its ends a route may wander, as a fraction of the distance between
// them, so a traverse has room to find a gentler line.
const ROUTE_PADDING = 0.5;
// So that two nearby points still leave room to switch back between them
const MIN_ROUTE_PADDING_METERS = 300;
// In cells. Half a cell keeps the route on the cells it found while dropping the staircase that
// the router's headings leave along any other angle.
const SIMPLIFY_TOLERANCE = 0.5;

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

export interface RouteRequest {
  kind: 'rr';
  id: number;
  // Mercator
  from: Vec2;
  to: Vec2;
  limits: GradeLimits;
}

export type Request = InitializeRequest|RouteRequest|SampleRequest;

export interface SampleResponse {
  kind: 'sr';
  id: number;
  // One per point, 0 where there is no data, which is what CalculateWayElevations assumes too.
  // Empty when sampling failed.
  meters: Float32Array;
}

export interface RouteResponse {
  kind: 'rr';
  id: number;
  // The way from from to to in mercator, excluding both, or undefined when no way keeps within
  // the limits.
  via: Float64Array|undefined;
  // Set when tiles could not be fetched, so that no route means nothing about the terrain
  failed: boolean;
}

export type Response = RouteResponse|SampleResponse;

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

  async route(request: RouteRequest): Promise<void> {
    const via = await this.routeVia(request);
    this.postMessage({kind: 'rr', id: request.id, via, failed: false}, via ? [via.buffer] : []);
  }

  failRoute(request: RouteRequest): void {
    this.postMessage({kind: 'rr', id: request.id, via: undefined, failed: true});
  }

  // Searches the pixels of the deepest zoom that fits the box around the ends in MAX_ROUTE_CELLS.
  private async routeVia(request: RouteRequest): Promise<Float64Array|undefined> {
    const {from, to} = request;
    for (let z = BASE_ZOOM; z >= MIN_ROUTE_ZOOM; --z) {
      const world = TILE_SIZE * Math.pow(2, z);
      // Mercator runs -1 to 1 and y grows north, pixels run 0 to world and y grows south.
      const fx = (from[0] + 1) / 2 * world;
      const fy = (1 - from[1]) / 2 * world;
      const tx = (to[0] + 1) / 2 * world;
      const ty = (1 - to[1]) / 2 * world;
      const latitude = Math.atan(Math.sinh(Math.PI * (from[1] + to[1]) / 2));
      const cellMeters = 2 * Math.PI * EARTH_RADIUS_METERS * Math.cos(latitude) / world;
      const pad =
          Math.max(
              ROUTE_PADDING * Math.hypot(tx - fx, ty - fy),
              MIN_ROUTE_PADDING_METERS / cellMeters);
      const x0 = Math.floor(Math.min(fx, tx) - pad);
      const y0 = Math.max(0, Math.floor(Math.min(fy, ty) - pad));
      const x1 = Math.ceil(Math.max(fx, tx) + pad);
      const y1 = Math.min(world, Math.ceil(Math.max(fy, ty) + pad));
      const width = x1 - x0;
      const height = y1 - y0;
      if (width * height > MAX_ROUTE_CELLS) {
        continue;
      }

      const meters = await this.pixels(z, x0, y0, width, height);
      const cellOf = (x: number, y: number) => Math.floor(y - y0) * width + Math.floor(x - x0);
      const cells =
          routeOverTerrain(
              {meters, width, height, cellMeters}, cellOf(fx, fy), cellOf(tx, ty), request.limits);
      if (!cells) {
        return undefined;
      }

      // The first and last cells stand in for the ends, which the caller already has.
      const kept = simplifyCells(cells, width, SIMPLIFY_TOLERANCE);
      const via = new Float64Array(Math.max(0, kept.length - 4));
      for (let i = 0; i < via.length; i += 2) {
        // Plus half a cell because a pixel's value sits at its center
        via[i] = (x0 + kept[i + 2] + 0.5) / world * 2 - 1;
        via[i + 1] = 1 - (y0 + kept[i + 3] + 0.5) / world * 2;
      }
      return via;
    }
    return undefined;
  }

  // Copies a box of pixels out of the tiles at z, with NaN where there is no tile.
  private async pixels(z: number, x0: number, y0: number, width: number, height: number):
      Promise<Float32Array> {
    const meters = new Float32Array(width * height).fill(NaN);
    const tiles = Math.pow(2, z);
    for (let ty = Math.floor(y0 / TILE_SIZE); ty * TILE_SIZE < y0 + height; ++ty) {
      for (let tx = Math.floor(x0 / TILE_SIZE); tx * TILE_SIZE < x0 + width; ++tx) {
        const tile = await this.tile(z, ((tx % tiles) + tiles) % tiles, ty);
        if (!tile) {
          continue;
        }

        const left = Math.max(x0, tx * TILE_SIZE);
        const right = Math.min(x0 + width, (tx + 1) * TILE_SIZE);
        const top = Math.max(y0, ty * TILE_SIZE);
        const bottom = Math.min(y0 + height, (ty + 1) * TILE_SIZE);
        for (let y = top; y < bottom; ++y) {
          const row = (y - ty * TILE_SIZE) * TILE_SIZE;
          meters.set(
              tile.subarray(row + left - tx * TILE_SIZE, row + right - tx * TILE_SIZE),
              (y - y0) * width + left - x0);
        }
      }
    }
    return meters;
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

    const loading = fetchTerrarium({x, y, zoom: z});
    // A fetch that failed is worth trying again, unlike a 404, which fetchTerrarium answers as
    // undefined.
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

// Answers requests one at a time, in order, so that tiles a request loads are cached for the next.
let queue = Promise.resolve();
const sampler = new ElevationSampler((self as any).postMessage.bind(self));
self.onmessage = e => {
  const request = e.data as Request;
  if (request.kind === 'ir') {
    // nothing to set up
  } else if (request.kind === 'rr') {
    queue = queue.then(() => sampler.route(request)).catch(e => {
      console.error(e);
      sampler.failRoute(request);
    });
  } else if (request.kind === 'sr') {
    queue = queue.then(() => sampler.sample(request)).catch(e => {
      console.error(e);
      sampler.fail(request);
    });
  } else {
    checkExhaustive(request);
  }
};
