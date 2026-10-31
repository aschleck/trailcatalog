import { SimpleS2 } from 'java/org/trailcatalog/s2';
import { checkExhaustive } from 'external/dev_april_corgi+/js/common/asserts';

import { Vec2 } from '../common/types';

import { BASE_ZOOM, fetchTerrarium, MAX_ZOOM, TILE_SIZE } from './terrarium';
import { getSunlight } from './sunlight';
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
// Mont Blanc stands 3800 m over Chamonix, so this covers most of the shadows that fall on a valley.
const SHADOW_RELIEF_METERS = 3_000;
const MAX_SHADOW_METERS = 40_000;
// The view and its padding toward the sun, which holds a phone's screen at its own pixels
const MAX_SUNLIGHT_PIXELS = 2560;
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

/** Shades the terrain in a box by the sun, see sunlight.ts#getSunlight. */
export interface SunlightRequest {
  kind: 'lr';
  id: number;
  // The box in mercator from 0 to 1, x east and y south
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  // The finest DEM zoom worth reading for the box on screen
  zoom: number;
  // Radians, with the altitude apparent rather than true
  azimuth: number;
  altitude: number;
  // How much of the light lit ground gets, from 1 for the sun down to 0 for a new moon
  brightness: number;
}

export type Request =
    InitializeRequest|RouteRequest|SampleRequest|SunlightRequest|TraceRequest;

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

export interface SunlightResponse {
  kind: 'lr';
  id: number;
  // The box the image covers, in mercator from 0 to 1, which is the request's snapped to pixels
  x: number;
  y: number;
  width: number;
  height: number;
  // Clear in full sun facing it and opaque white in shadow, so a tint colors it. Empty when the
  // tiles could not be fetched.
  pixels: [number, number];
  rgba: Uint8ClampedArray<ArrayBuffer>;
}

export type Response = RouteResponse|SampleResponse|SunlightResponse|TraceResponse;

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

  async shade(request: SunlightRequest): Promise<void> {
    const {azimuth, altitude} = request;
    // A shadow reaches as far as the tallest terrain around can throw it, which we take to be
    // SHADOW_RELIEF_METERS above the ground it falls on.
    const lat = Math.atan(Math.sinh(Math.PI * (1 - (request.y0 + request.y1))));
    const reach =
        altitude > 0
            ? Math.min(SHADOW_RELIEF_METERS / Math.tan(altitude), MAX_SHADOW_METERS)
            : 0;
    const reachWorld = reach / (2 * Math.PI * SimpleS2.EARTH_RADIUS_METERS * Math.cos(lat));
    const ux = Math.sin(azimuth);
    const uy = -Math.cos(azimuth);
    const box = [
      request.x0 + Math.min(ux, 0) * reachWorld,
      request.y0 + Math.min(uy, 0) * reachWorld,
      request.x1 + Math.max(ux, 0) * reachWorld,
      request.y1 + Math.max(uy, 0) * reachWorld,
    ];
    let zoom = Math.min(request.zoom, MAX_ZOOM);
    const span = Math.max(box[2] - box[0], box[3] - box[1]);
    while (zoom > 0 && span * TILE_SIZE * 2 ** zoom > MAX_SUNLIGHT_PIXELS) {
      zoom -= 1;
    }

    const world = TILE_SIZE * 2 ** zoom;
    const [px0, py0] = [Math.floor(box[0] * world), Math.max(Math.floor(box[1] * world), 0)];
    const [px1, py1] = [Math.ceil(box[2] * world), Math.min(Math.ceil(box[3] * world), world)];
    const [width, height] = [px1 - px0, py1 - py0];
    const heights = new Float32Array(width * height);
    for (let ty = Math.floor(py0 / TILE_SIZE); ty * TILE_SIZE < py1; ++ty) {
      for (let tx = Math.floor(px0 / TILE_SIZE); tx * TILE_SIZE < px1; ++tx) {
        const tiles = 2 ** zoom;
        const tile = await this.tileOrAncestor(zoom, ((tx % tiles) + tiles) % tiles, ty);
        if (!tile) {
          continue;
        }
        const left = Math.max(px0, tx * TILE_SIZE);
        const right = Math.min(px1, (tx + 1) * TILE_SIZE);
        for (let y = Math.max(py0, ty * TILE_SIZE); y < Math.min(py1, (ty + 1) * TILE_SIZE); ++y) {
          const row = (y - ty * TILE_SIZE) * TILE_SIZE;
          heights.set(
              tile.subarray(row + left - tx * TILE_SIZE, row + right - tx * TILE_SIZE),
              (y - py0) * width + left - px0);
        }
      }
    }

    const pixelMeters = 2 * Math.PI * SimpleS2.EARTH_RADIUS_METERS * Math.cos(lat) / world;
    const darkness = getSunlight(heights, width, height, pixelMeters, azimuth, altitude);
    // Back to the box that was asked for, now that the padding has cast its shadows
    const [cx0, cy0] = [Math.floor(request.x0 * world) - px0, Math.floor(request.y0 * world) - py0];
    const cx1 = Math.min(Math.ceil(request.x1 * world) - px0, width);
    const cy1 = Math.min(Math.ceil(request.y1 * world) - py0, height);
    const [cw, ch] = [cx1 - Math.max(cx0, 0), cy1 - Math.max(cy0, 0)];
    const rgba = new Uint8ClampedArray(4 * cw * ch);
    for (let y = 0; y < ch; ++y) {
      for (let x = 0; x < cw; ++x) {
        const lit = 1 - darkness[(y + Math.max(cy0, 0)) * width + x + Math.max(cx0, 0)];
        const value = 255 * (1 - lit * request.brightness);
        rgba.fill(value, 4 * (y * cw + x), 4 * (y * cw + x) + 4);
      }
    }
    this.postMessage(
        {
          kind: 'lr',
          id: request.id,
          x: (px0 + Math.max(cx0, 0)) / world,
          y: (py0 + Math.max(cy0, 0)) / world,
          width: cw / world,
          height: ch / world,
          pixels: [cw, ch],
          rgba,
        },
        [rgba.buffer]);
  }

  failShade(request: SunlightRequest): void {
    this.postMessage({
      kind: 'lr',
      id: request.id,
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      pixels: [0, 0],
      rgba: new Uint8ClampedArray(0),
    });
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
      const cellMeters = 2 * Math.PI * SimpleS2.EARTH_RADIUS_METERS * Math.cos(latitude) / world;
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

  // Upsamples the nearest coarser tile where Mapterhorn has none at z, because only some places
  // are covered past BASE_ZOOM.
  private async tileOrAncestor(z: number, x: number, y: number): Promise<Tile> {
    const tile = await this.tile(z, x, y);
    if (tile || z <= BASE_ZOOM) {
      return tile;
    }
    for (let dz = 1; z - dz >= BASE_ZOOM; ++dz) {
      const ancestor = await this.tile(z - dz, x >> dz, y >> dz);
      if (ancestor) {
        return upsample(ancestor, dz, x - ((x >> dz) << dz), y - ((y >> dz) << dz));
      }
    }
    return undefined;
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
 * band's zoom has no tile, the lookup reads the next coarser zoom that has one.
 */
async function loadBand(lat: number, lng: number, band: TraceBand): Promise<HeightAt> {
  const [x, y] = toWorld(lat, lng);
  // In world units, which span the Earth at the equator and less of it toward the poles. A pixel
  // more covers the bilinear corners at the edge.
  const radius =
      (band.toMeters + getPixelMeters(band.zoom, lat))
          / (2 * Math.PI * SimpleS2.EARTH_RADIUS_METERS * Math.cos(lat));
  const grids = [await loadGrid(band.zoom, x - radius, y - radius, x + radius, y + radius)];
  for (let z = band.zoom - 1; z >= BASE_ZOOM; --z) {
    if (!grids[grids.length - 1].tiles.some(tile => tile === undefined)) {
      break;
    }
    grids.push(await loadGrid(z, x - radius, y - radius, x + radius, y + radius));
  }
  return (latRadians, lngRadians) => {
    const [wx, wy] = toWorld(latRadians, lngRadians);
    for (const grid of grids) {
      const height = grid.bilinear(wx, wy);
      if (height !== undefined) {
        return height;
      }
    }
    return 0;
  };
}

// Returns the part of a tile dz zooms coarser that covers its descendant at column x and row y
// within it, read bilinearly between the coarse pixel centers.
function upsample(ancestor: Float32Array, dz: number, x: number, y: number): Float32Array {
  const scale = 2 ** dz;
  const meters = new Float32Array(TILE_SIZE * TILE_SIZE);
  for (let j = 0; j < TILE_SIZE; ++j) {
    // Minus half a pixel because a pixel's value sits at its center
    const ay = Math.min(Math.max((y * TILE_SIZE + j + 0.5) / scale - 0.5, 0), TILE_SIZE - 1);
    const y0 = Math.floor(ay);
    const y1 = Math.min(y0 + 1, TILE_SIZE - 1);
    const fy = ay - y0;
    for (let i = 0; i < TILE_SIZE; ++i) {
      const ax = Math.min(Math.max((x * TILE_SIZE + i + 0.5) / scale - 0.5, 0), TILE_SIZE - 1);
      const x0 = Math.floor(ax);
      const x1 = Math.min(x0 + 1, TILE_SIZE - 1);
      const fx = ax - x0;
      const top = ancestor[y0 * TILE_SIZE + x0] * (1 - fx) + ancestor[y0 * TILE_SIZE + x1] * fx;
      const bottom =
          ancestor[y1 * TILE_SIZE + x0] * (1 - fx) + ancestor[y1 * TILE_SIZE + x1] * fx;
      meters[j * TILE_SIZE + i] = top * (1 - fy) + bottom * fy;
    }
  }
  return meters;
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
  } else if (request.kind === 'lr') {
    queue = queue.then(() => sampler.shade(request)).catch(e => {
      console.error(e);
      sampler.failShade(request);
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
