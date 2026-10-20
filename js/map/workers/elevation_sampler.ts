import { checkExhaustive } from 'external/dev_april_corgi+/js/common/asserts';

import { Vec2 } from '../common/types';

import { BASE_ZOOM, fetchTerrarium, TILE_SIZE } from './terrarium';
import { GradeLimits, routeOverTerrain, simplifyCells } from './terrain_router';
import {
  drawViewshed,
  getPixelMeters,
  HeightAt,
  SKYLINE_AZIMUTHS,
  SKYLINE_BANDS,
  TerrainTracer,
  TraceBand,
  VIEWSHED_AZIMUTHS,
  VIEWSHED_BANDS,
  ViewshedImage,
} from './terrain_tracer';

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
  // A newer request with the same key makes this one stale, so the worker stops sampling it.
  key: string|undefined;
}

export interface RouteRequest {
  kind: 'rr';
  id: number;
  // Mercator
  from: Vec2;
  to: Vec2;
  limits: GradeLimits;
}

/** Traces the terrain around a point, see TerrainTracer. */
export interface TraceRequest {
  kind: 'tr';
  id: number;
  latDegrees: number;
  lngDegrees: number;
  // The source's eye above its ground, and how far above the ground a target has to be seen
  sourceHeight: number;
  targetHeight: number;
  // The skyline reaches farther, and the viewshed casts more rays so they meet at its edge.
  of: 'skyline'|'viewshed';
}

export type Request = InitializeRequest|RouteRequest|SampleRequest|TraceRequest;

export interface SampleResponse {
  kind: 'sr';
  id: number;
  // One per point, 0 where there is no data, which is what CalculateWayElevations assumes too.
  // Empty when sampling failed or a newer request with the same key replaced this one.
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

export interface TraceResponse {
  kind: 'tr';
  id: number;
  groundMeters: number;
  // By azimuth, see TerrainTracer#skyline
  skyline: Float32Array;
  // One for each band of a viewshed, nearest first, and empty for a skyline
  images: ViewshedImage[];
  // Set when tiles could not be fetched
  failed: boolean;
}

export type Response = RouteResponse|SampleResponse|TraceResponse;

type Tile = Float32Array|undefined;

/** Samples Mapterhorn elevations with bilinear interpolation between pixel centers. */
class ElevationSampler {

  // By z/x/y, oldest first, so that trimming drops the tile used longest ago
  private readonly tiles: Map<string, Promise<Tile>>;
  // The id of the newest sample request with each key
  private readonly newest: Map<string, number>;

  constructor(
      private readonly postMessage: (response: Response, transfer?: Transferable[]) => void,
  ) {
    this.tiles = new Map();
    this.newest = new Map();
  }

  /** Marks older requests with the same key as stale, before this one waits its turn. */
  received(request: SampleRequest): void {
    if (request.key !== undefined) {
      this.newest.set(request.key, request.id);
    }
  }

  async sample(request: SampleRequest): Promise<void> {
    const count = request.latLngDegrees.length / 2;
    const meters = new Float32Array(count);
    for (let i = 0; i < count; ++i) {
      if (request.key !== undefined && this.newest.get(request.key) !== request.id) {
        this.fail(request);
        return;
      }
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

  async trace(request: TraceRequest): Promise<void> {
    const [bands, azimuths] =
        request.of === 'skyline'
            ? [SKYLINE_BANDS, SKYLINE_AZIMUTHS]
            : [VIEWSHED_BANDS, VIEWSHED_AZIMUTHS];
    const lat = request.latDegrees * Math.PI / 180;
    const lng = request.lngDegrees * Math.PI / 180;
    const ground = await this.sampleAt(request.latDegrees, request.lngDegrees, bands[0].zoom);
    const tracer =
        new TerrainTracer(
            lat, lng, ground + request.sourceHeight, request.targetHeight, azimuths);
    // One band's tiles at a time, because the farthest is a few dozen megabytes on its own
    for (const band of bands) {
      tracer.trace(band, await loadBand(lat, lng, band));
    }
    const images = [];
    if (request.of === 'viewshed') {
      const viewshed = tracer.getViewshed();
      let from = 0;
      for (const band of bands) {
        images.push(drawViewshed(lat, lng, viewshed, from, band));
        from = band.toMeters;
      }
    }
    const skyline = tracer.skyline;
    this.postMessage(
        {kind: 'tr', id: request.id, groundMeters: ground, skyline, images, failed: false},
        [skyline.buffer, ...images.map(image => image.rgba.buffer)]);
  }

  failTrace(request: TraceRequest): void {
    this.postMessage({
      kind: 'tr',
      id: request.id,
      groundMeters: 0,
      skyline: new Float32Array(0),
      images: [],
      failed: true,
    });
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
  // BASE_ZOOM. Every place is covered at BASE_ZOOM and coarser, so those read their own zoom.
  private async sampleAt(lat: number, lng: number, zoom: number): Promise<number> {
    for (let z = zoom; z >= Math.min(zoom, BASE_ZOOM); --z) {
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

/**
 * Loads the tiles a band reaches into a grid and returns a bilinear lookup over them. Where the
 * band's zoom has no tile, the lookup reads the BASE_ZOOM tile around it instead.
 */
async function loadBand(lat: number, lng: number, band: TraceBand): Promise<HeightAt> {
  const [x, y] = toWorld(lat, lng);
  // In world units, which span the Earth at the equator and less of it toward the poles. A pixel
  // more covers the bilinear corners at the edge.
  const radius =
      (band.toMeters + getPixelMeters(band.zoom, lat))
          / (2 * Math.PI * EARTH_RADIUS_METERS * Math.cos(lat));
  const grid = await loadGrid(band.zoom, x - radius, y - radius, x + radius, y + radius);
  const missing = grid.tiles.some(tile => tile === undefined);
  const fallback =
      band.zoom > BASE_ZOOM && missing
          ? await loadGrid(BASE_ZOOM, x - radius, y - radius, x + radius, y + radius)
          : undefined;
  return (latRadians, lngRadians) => {
    const [wx, wy] = toWorld(latRadians, lngRadians);
    return grid.bilinear(wx, wy) ?? fallback?.bilinear(wx, wy) ?? 0;
  };
}

// Mercator with the world from 0 to 1, x east and y south
function toWorld(lat: number, lng: number): [number, number] {
  const sin = Math.sin(lat);
  return [(lng + Math.PI) / (2 * Math.PI), 0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)];
}

async function loadGrid(zoom: number, x0: number, y0: number, x1: number, y1: number):
    Promise<TileGrid> {
  const tiles = 2 ** zoom;
  const [tx0, ty0] = [Math.floor(x0 * tiles), Math.max(Math.floor(y0 * tiles), 0)];
  const [tx1, ty1] = [Math.floor(x1 * tiles), Math.min(Math.floor(y1 * tiles), tiles - 1)];
  const loads = [];
  for (let ty = ty0; ty <= ty1; ++ty) {
    for (let tx = tx0; tx <= tx1; ++tx) {
      loads.push(fetchTerrarium({x: ((tx % tiles) + tiles) % tiles, y: ty, zoom}));
    }
  }
  return new TileGrid(zoom, tx0, ty0, tx1 - tx0 + 1, await Promise.all(loads));
}

// Tiles in rows from a corner, which looks one up by arithmetic rather than by a key
class TileGrid {

  private readonly world: number;
  private readonly rows: number;

  constructor(
      zoom: number,
      private readonly tx0: number,
      private readonly ty0: number,
      private readonly columns: number,
      readonly tiles: Tile[]) {
    this.world = TILE_SIZE * 2 ** zoom;
    this.rows = tiles.length / columns;
  }

  // Undefined where a corner has no tile, so that the caller can read a coarser zoom
  bilinear(x: number, y: number): number|undefined {
    // Minus half a pixel because a pixel's value sits at its center
    const px = x * this.world - 0.5;
    const py = y * this.world - 0.5;
    const x0 = Math.floor(px);
    const y0 = Math.floor(py);
    const fx = px - x0;
    const fy = py - y0;
    const c00 = this.pixel(x0, y0);
    const c10 = this.pixel(x0 + 1, y0);
    const c01 = this.pixel(x0, y0 + 1);
    const c11 = this.pixel(x0 + 1, y0 + 1);
    if (c00 === undefined || c10 === undefined || c01 === undefined || c11 === undefined) {
      return undefined;
    }
    return (c00 * (1 - fx) + c10 * fx) * (1 - fy) + (c01 * (1 - fx) + c11 * fx) * fy;
  }

  private pixel(x: number, y: number): number|undefined {
    const clampedY = Math.min(Math.max(y, 0), this.world - 1);
    const column = Math.floor(x / TILE_SIZE) - this.tx0;
    const row = Math.floor(clampedY / TILE_SIZE) - this.ty0;
    if (column < 0 || column >= this.columns || row < 0 || row >= this.rows) {
      return undefined;
    }
    const tile = this.tiles[row * this.columns + column];
    const inX = x - (column + this.tx0) * TILE_SIZE;
    const inY = clampedY - (row + this.ty0) * TILE_SIZE;
    return tile?.[inY * TILE_SIZE + inX];
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
    sampler.received(request);
    queue = queue.then(() => sampler.sample(request)).catch(e => {
      console.error(e);
      sampler.fail(request);
    });
  } else if (request.kind === 'tr') {
    queue = queue.then(() => sampler.trace(request)).catch(e => {
      console.error(e);
      sampler.failTrace(request);
    });
  } else {
    checkExhaustive(request);
  }
};
