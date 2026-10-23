import { checkExhaustive } from 'external/dev_april_corgi+/js/common/asserts';

import { RgbaU32, TileId } from '../common/types';
import { LineProgram } from '../rendering/line_program';

import { Reply, serveClients } from './client_pool';
import { readPacked, unpackChannel } from './weather';

// Keep in sync with Weather.kt#TILE_SIZE
const TILE_SIZE = 256;
// Keep in sync with Weather.kt#MAX_ZOOM
const MAX_ZOOM = 3;
// Seeds sit one per cell of a lattice this many pixels across at the zoom level we trace for, so
// between this and twice this at the zoom level after it.
const STREAMLINE_SPACING_PX = 48;
const BARB_SPACING_PX = 56;
// A streamline is as long as the wind would carry it in a fixed time, so its length is the speed:
// 10 m/s draws 30 px and 40 m/s draws 120 px.
const PX_PER_MPS = 3;
// in m/s, below which the line would be shorter than its own width
const MIN_SPEED_MPS = 1;
// Midpoint steps across the whole line, half before the seed and half after it
const STEPS = 16;
// in pixels, tapering from tail to head so the line reads as pointing downwind
const TAIL_RADIUS = 1.25;
const HEAD_RADIUS = 2;
const FILL = 0xFFFFFFDD as RgbaU32;
const STROKE = 0x00000099 as RgbaU32;
const KNOTS_PER_MPS = 1.943844;
// Barbs follow the station model: the staff runs from the seed into the wind, and from its far end
// in come a pennant per 50 knots, a long barb per 10, and a short barb for a remaining 5.
const BARB_STAFF_PX = 28;
const BARB_LENGTH_PX = 11;
const BARB_GAP_PX = 4;
const PENNANT_BASE_PX = 5;
const BARB_RADIUS = 1.5;

export type WindStyle = 'barbs'|'streamlines';

export interface Viewport {
  lat: [number, number];
  lng: [number, number];
  zoom: number;
  // See xyz_data_fetcher.ts#Viewport
  cone?: {
    camDir: [number, number, number];
    cosThetaT: number;
  };
}

interface LoadRequest {
  kind: 'lr';
  id: TileId;
  data: ArrayBuffer;
}

interface TraceRequest {
  kind: 'tr';
  style: WindStyle;
  viewport: Viewport;
}

interface UnloadRequest {
  kind: 'ur';
  ids: TileId[];
}

export type Request = LoadRequest|TraceRequest|UnloadRequest;

export interface LoadResponse {
  kind: 'lr';
  id: TileId;
}

// LineProgram instances for every streamline or barb, back to back
export interface TraceResponse {
  kind: 'tr';
  geometry: ArrayBuffer;
  geometryByteLength: number;
  instanceCount: number;
}

export type Response = LoadResponse|TraceResponse;

interface Tile {
  u: Float32Array;
  v: Float32Array;
}

interface Polyline {
  points: Float32Array;
  // one per segment
  radii: Float32Array;
}

class WindLoader {

  // Tiles still decoding, which an unload drops so the decode doesn't store them after
  private readonly decoding: Set<number>;
  private readonly tiles: Map<number, Tile>;

  constructor() {
    this.decoding = new Set();
    this.tiles = new Map();
  }

  async load(request: LoadRequest): Promise<Reply<Response>> {
    const key = tileKey(request.id.zoom, request.id.x, request.id.y);
    this.decoding.add(key);
    const pixels = await readPacked(new Blob([request.data]));
    if (this.decoding.delete(key)) {
      this.tiles.set(key, {
        u: unpackChannel('wind', 'u', pixels.data),
        v: unpackChannel('wind', 'v', pixels.data),
      });
    }
    return {message: {kind: 'lr', id: request.id}};
  }

  unload(request: UnloadRequest): void {
    for (const id of request.ids) {
      const key = tileKey(id.zoom, id.x, id.y);
      this.decoding.delete(key);
      this.tiles.delete(key);
    }
  }

  trace(request: TraceRequest): Reply<Response> {
    const {style, viewport} = request;
    const level = Math.max(0, Math.floor(viewport.zoom));
    const spacingPx = style === 'barbs' ? BARB_SPACING_PX : STREAMLINE_SPACING_PX;
    // Cells divide the world evenly so the lattice lines up across the antimeridian.
    const cells = Math.max(1, Math.round(TILE_SIZE * 2 ** level / spacingPx));
    const spacing = 2 / cells;
    // Mercator units per pixel
    const pixel = 2 / (TILE_SIZE * 2 ** viewport.zoom);
    const zooms = this.zooms();

    let xLo = viewport.lng[0] / Math.PI;
    let xHi = viewport.lng[1] / Math.PI;
    if (viewport.lng[1] - viewport.lng[0] >= 2 * Math.PI) {
      xLo = -1;
      xHi = 1;
    } else if (xHi < xLo) {
      xHi += 2;
    }
    const yLo = Math.max(latToMercatorY(viewport.lat[0]), -1);
    const yHi = Math.min(latToMercatorY(viewport.lat[1]), 1);

    const lines: Polyline[] = [];
    for (let j = Math.floor(yLo / spacing); j < Math.ceil(yHi / spacing); ++j) {
      for (let i = Math.floor(xLo / spacing); i < Math.ceil(xHi / spacing); ++i) {
        const cell = ((i % cells) + cells) % cells;
        const x = (i + jitter(cell, j, level, 0)) * spacing;
        const y = (j + jitter(cell, j, level, 1)) * spacing;
        if (y < yLo || y > yHi || !inCone(x, y, viewport.cone)) {
          continue;
        }
        if (style === 'barbs') {
          this.barb(x, y, pixel, zooms, lines);
        } else {
          this.streamline(x, y, pixel, zooms, lines);
        }
      }
    }

    let bytes = 0;
    for (const {points} of lines) {
      bytes += LineProgram.bytesNeeded(points.length / 2);
    }
    const geometry = new ArrayBuffer(bytes);
    let offset = 0;
    let instanceCount = 0;
    for (const {points, radii} of lines) {
      const result =
          LineProgram.push(FILL, STROKE, radii, /* pattern= */ 'solid', points, geometry, offset);
      offset += result.geometryByteLength;
      instanceCount += result.instanceCount;
    }

    return {
      message: {kind: 'tr', geometry, geometryByteLength: offset, instanceCount},
      transfer: [geometry],
    };
  }

  private barb(x: number, y: number, pixel: number, zooms: number[], lines: Polyline[]): void {
    const wind: [number, number] = [0, 0];
    if (!this.sample(x, y, zooms, wind)) {
      return;
    }
    const speed = Math.hypot(wind[0], wind[1]);
    let knots = Math.round(speed * KNOTS_PER_MPS / 5) * 5;
    if (knots < 5) {
      return;
    }

    // One pixel along the staff into the wind, and one pixel toward the side the barbs go, which
    // is clockwise of the staff in the northern hemisphere and counterclockwise in the southern.
    const dx = -wind[0] / speed * pixel;
    const dy = -wind[1] / speed * pixel;
    const sx = y >= 0 ? dy : -dy;
    const sy = y >= 0 ? -dx : dx;
    const ex = x + BARB_STAFF_PX * dx;
    const ey = y + BARB_STAFF_PX * dy;
    const add = (...points: number[]) => {
      lines.push({
        points: new Float32Array(points),
        radii: new Float32Array(points.length / 2 - 1).fill(BARB_RADIUS),
      });
    };
    // Barbs lean out toward the end of the staff.
    const tip = (px: number, length: number) => [
      ex - px * dx + length * (0.5 * dx + 0.866 * sx),
      ey - px * dy + length * (0.5 * dy + 0.866 * sy),
    ];

    add(x, y, ex, ey);
    // in pixels from the far end of the staff
    let along = 0;
    while (knots >= 50) {
      add(
          ex - along * dx, ey - along * dy,
          ...tip(along + PENNANT_BASE_PX, BARB_LENGTH_PX),
          ex - (along + PENNANT_BASE_PX) * dx, ey - (along + PENNANT_BASE_PX) * dy);
      along += PENNANT_BASE_PX + 1;
      knots -= 50;
    }
    while (knots >= 10) {
      add(ex - along * dx, ey - along * dy, ...tip(along, BARB_LENGTH_PX));
      along += BARB_GAP_PX;
      knots -= 10;
    }
    if (knots >= 5) {
      // A lone short barb sits in from the end so it doesn't read as a long one.
      if (along === 0) {
        along = BARB_GAP_PX;
      }
      add(ex - along * dx, ey - along * dy, ...tip(along, BARB_LENGTH_PX / 2));
    }
  }

  // Traces the line through a seed, half of its time before the seed and half after.
  private streamline(
      x: number, y: number, pixel: number, zooms: number[], lines: Polyline[]): void {
    const wind: [number, number] = [0, 0];
    if (!this.sample(x, y, zooms, wind)) {
      return;
    }
    if (Math.hypot(wind[0], wind[1]) < MIN_SPEED_MPS) {
      return;
    }

    const scale = PX_PER_MPS * pixel / STEPS;
    const half = STEPS / 2;
    const points = new Float32Array(2 * (STEPS + 1));
    // Walk backward first and write those points from the middle down, so the line runs tail to
    // head.
    points[2 * half] = x;
    points[2 * half + 1] = y;
    let first = half;
    for (let k = 0; k < half; ++k) {
      const next = this.step(points[2 * first], points[2 * first + 1], -scale, zooms, wind);
      if (!next) {
        break;
      }
      first -= 1;
      points[2 * first] = next[0];
      points[2 * first + 1] = next[1];
    }
    let last = half;
    for (let k = 0; k < half; ++k) {
      const next = this.step(points[2 * last], points[2 * last + 1], scale, zooms, wind);
      if (!next) {
        break;
      }
      last += 1;
      points[2 * last] = next[0];
      points[2 * last + 1] = next[1];
    }

    const count = last - first + 1;
    if (count < 2) {
      return;
    }
    const radii = new Float32Array(count - 1);
    for (let k = 0; k < count - 1; ++k) {
      radii[k] = TAIL_RADIUS + (HEAD_RADIUS - TAIL_RADIUS) * k / Math.max(count - 2, 1);
    }
    lines.push({points: points.slice(2 * first, 2 * (last + 1)), radii});
  }

  // Mercator is conformal, so east and north in m/s point the same way in Mercator x and y.
  private step(
      x: number,
      y: number,
      scale: number,
      zooms: number[],
      wind: [number, number],
  ): [number, number]|undefined {
    if (!this.sample(x, y, zooms, wind)) {
      return undefined;
    }
    const mx = x + 0.5 * scale * wind[0];
    const my = y + 0.5 * scale * wind[1];
    if (!this.sample(mx, my, zooms, wind)) {
      return undefined;
    }
    return [x + scale * wind[0], y + scale * wind[1]];
  }

  // Interpolates u and v at a Mercator point from the most detailed tiles that cover it.
  private sample(x: number, y: number, zooms: number[], out: [number, number]): boolean {
    for (const zoom of zooms) {
      const worldPx = TILE_SIZE * 2 ** zoom;
      // Pixel centers sit half a pixel in, see Weather.kt#TilePixels.
      const px = (x + 1) / 2 * worldPx - 0.5;
      const py = (1 - y) / 2 * worldPx - 0.5;
      const x0 = Math.floor(px);
      const y0 = Math.floor(py);
      const tx = px - x0;
      const ty = py - y0;
      let u = 0;
      let v = 0;
      let covered = true;
      for (let c = 0; c < 4 && covered; ++c) {
        const dx = c & 1;
        const dy = c >> 1;
        const gx = (((x0 + dx) % worldPx) + worldPx) % worldPx;
        const gy = Math.min(Math.max(y0 + dy, 0), worldPx - 1);
        const tile =
            this.tiles.get(
                tileKey(zoom, Math.floor(gx / TILE_SIZE), Math.floor(gy / TILE_SIZE)));
        if (!tile) {
          covered = false;
          break;
        }
        const i = (gy % TILE_SIZE) * TILE_SIZE + gx % TILE_SIZE;
        const weight = (dx ? tx : 1 - tx) * (dy ? ty : 1 - ty);
        u += weight * tile.u[i];
        v += weight * tile.v[i];
      }
      if (covered) {
        out[0] = u;
        out[1] = v;
        return !isNaN(u) && !isNaN(v);
      }
    }
    return false;
  }

  // Zoom levels that have any tiles, most detailed first
  private zooms(): number[] {
    const zooms = new Set<number>();
    for (const key of this.tiles.keys()) {
      zooms.add(Math.floor(key / (1 << 2 * MAX_ZOOM)));
    }
    return [...zooms].sort((a, b) => b - a);
  }
}

function tileKey(zoom: number, x: number, y: number): number {
  return (zoom << 2 * MAX_ZOOM) | (y << MAX_ZOOM) | x;
}

function latToMercatorY(lat: number): number {
  return Math.log(Math.tan(Math.PI / 4 + lat / 2)) / Math.PI;
}

// Offsets each seed within its cell by a hash of the cell, so seeds don't line up in rows and
// stay put as the camera moves.
function jitter(i: number, j: number, level: number, axis: number): number {
  let h =
      Math.imul(i, 0x27D4EB2D) ^ Math.imul(j, 0x165667B1) ^ Math.imul(level * 2 + axis, 0x9E3779B1);
  h = Math.imul(h ^ (h >>> 15), 0x85EBCA6B);
  h ^= h >>> 13;
  return (h >>> 0) / 0x100000000;
}

function inCone(x: number, y: number, cone: Viewport['cone']): boolean {
  if (!cone) {
    return true;
  }
  const lat = Math.atan(Math.sinh(y * Math.PI));
  const lng = x * Math.PI;
  const dot =
      Math.cos(lat) * Math.cos(lng) * cone.camDir[0]
          + Math.sin(lat) * cone.camDir[1]
          + Math.cos(lat) * Math.sin(lng) * cone.camDir[2];
  return dot >= cone.cosThetaT;
}

serveClients<undefined, Request, Response>(() => {
  const loader = new WindLoader();
  return request => {
    if (request.kind === 'lr') {
      return loader.load(request);
    } else if (request.kind === 'tr') {
      return loader.trace(request);
    } else if (request.kind === 'ur') {
      loader.unload(request);
      return undefined;
    } else {
      throw checkExhaustive(request);
    }
  };
});
