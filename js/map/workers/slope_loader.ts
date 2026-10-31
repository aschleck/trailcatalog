import { checkExhaustive } from 'external/dev_april_corgi+/js/common/asserts';

import { TileId } from '../common/types';

import { serveClients } from './client_pool';
import { decodeTerrarium, fetchTerrarium, TILE_SIZE } from './terrarium';

// Horn's method reads a pixel past each output pixel, and the output reaches a pixel into each
// neighbor, so we need two pixels of every neighbor's elevations.
const DEPTH = 2;
const PADDED_SIZE = TILE_SIZE + 2 * DEPTH;
// Keep in sync with slope_layer.ts#SLOPES_SIZE
const SLOPES_SIZE = TILE_SIZE + 2;
// Each tile's edges are 16 kB, and a viewport at z11 touches around 240 z12 tiles.
const EDGE_CACHE_SIZE = 512;
// Keep in sync with SimpleS2#EARTH_RADIUS_METERS
const EARTH_RADIUS_METERS = 6371010;

interface LoadRequest {
  kind: 'lr';
  id: TileId;
  // The tile as fetched, or undefined to fetch it here because it stands in for a missing finer one
  data: ArrayBuffer|undefined;
}

export type Request = LoadRequest;

export interface LoadResponse {
  kind: 'lr';
  id: TileId;
  // Slope in degrees scaled from 0 to 90 into 0 to 255, SLOPES_SIZE to a side. The tile's pixels
  // sit inside a one pixel frame holding the slopes of its neighbors' nearest pixels, so the
  // texture filters across tile edges the same way from either side. Undefined when the tile or a
  // neighbor couldn't be fetched.
  slopes: Uint8Array|undefined;
  // Set when Mapterhorn has no tile here, so a coarser one has to stand in
  missing: boolean;
}

export type Response = LoadResponse;

// The DEPTH rows or columns of elevations along each side of a tile, row major
interface Edges {
  top: Float32Array;
  bottom: Float32Array;
  left: Float32Array;
  right: Float32Array;
}

class SlopeLoader {

  // By z/x/y, oldest first, so that trimming drops the tile used longest ago
  private readonly edges: Map<string, Promise<Edges|undefined>>;

  constructor(
      private readonly postMessage: (response: Response, transfer?: Transferable[]) => void,
  ) {
    this.edges = new Map();
  }

  async load(request: LoadRequest): Promise<void> {
    const {id} = request;
    let slopes;
    let missing = false;
    try {
      const meters =
          request.data
              ? await decodeTerrarium(new Blob([request.data]))
              : await fetchTerrarium(id);
      if (meters) {
        this.remember(id, Promise.resolve(edgesOf(meters)));

        const neighbors = [];
        for (let dy = -1; dy <= 1; ++dy) {
          for (let dx = -1; dx <= 1; ++dx) {
            neighbors.push(dx === 0 && dy === 0 ? undefined : this.neighbor(id, dx, dy));
          }
        }
        slopes = computeSlopes(id, pad(meters, await Promise.all(neighbors)));
      } else {
        this.remember(id, Promise.resolve(undefined));
        missing = true;
      }
    } catch (e) {
      console.error(e);
      slopes = undefined;
    }
    this.postMessage({kind: 'lr', id, slopes, missing}, slopes ? [slopes.buffer] : []);
  }

  private neighbor(id: TileId, dx: number, dy: number): Promise<Edges|undefined> {
    const world = Math.pow(2, id.zoom);
    const y = id.y + dy;
    if (y < 0 || y >= world) {
      return Promise.resolve(undefined);
    }

    const neighbor = {x: (id.x + dx + world) % world, y, zoom: id.zoom};
    const key = `${neighbor.zoom}/${neighbor.x}/${neighbor.y}`;
    const cached = this.edges.get(key);
    if (cached) {
      this.edges.delete(key);
      this.edges.set(key, cached);
      return cached;
    }

    const loading = fetchTerrarium(neighbor).then(meters => meters ? edgesOf(meters) : undefined);
    // A fetch that failed is worth trying again, unlike a 404, which fetchTerrarium answers as
    // undefined.
    loading.catch(() => {
      this.edges.delete(key);
    });
    this.remember(neighbor, loading);
    return loading;
  }

  private remember(id: TileId, edges: Promise<Edges|undefined>): void {
    const key = `${id.zoom}/${id.x}/${id.y}`;
    this.edges.delete(key);
    this.edges.set(key, edges);
    while (this.edges.size > EDGE_CACHE_SIZE) {
      this.edges.delete(this.edges.keys().next().value!);
    }
  }
}

function edgesOf(meters: Float32Array): Edges {
  const left = new Float32Array(TILE_SIZE * DEPTH);
  const right = new Float32Array(TILE_SIZE * DEPTH);
  for (let y = 0; y < TILE_SIZE; ++y) {
    for (let x = 0; x < DEPTH; ++x) {
      left[y * DEPTH + x] = meters[y * TILE_SIZE + x];
      right[y * DEPTH + x] = meters[y * TILE_SIZE + TILE_SIZE - DEPTH + x];
    }
  }
  return {
    top: meters.slice(0, DEPTH * TILE_SIZE),
    bottom: meters.slice((TILE_SIZE - DEPTH) * TILE_SIZE),
    left,
    right,
  };
}

// Reads a pixel within DEPTH of an edge, in the tile's own coordinates.
function edgeAt(edges: Edges, x: number, y: number): number {
  if (y < DEPTH) {
    return edges.top[y * TILE_SIZE + x];
  } else if (y >= TILE_SIZE - DEPTH) {
    return edges.bottom[(y - TILE_SIZE + DEPTH) * TILE_SIZE + x];
  } else if (x < DEPTH) {
    return edges.left[y * DEPTH + x];
  } else {
    return edges.right[y * DEPTH + x - TILE_SIZE + DEPTH];
  }
}

// Surrounds the tile with DEPTH pixels of its neighbors, which are row major from the northwest.
// Where a neighbor is missing the tile's own edge repeats outward, which is right because Mapterhorn
// has no tile there to draw a seam against.
function pad(meters: Float32Array, neighbors: Array<Edges|undefined>): Float32Array {
  const padded = new Float32Array(PADDED_SIZE * PADDED_SIZE);
  for (let py = 0; py < PADDED_SIZE; ++py) {
    const y = py - DEPTH;
    const dy = y < 0 ? -1 : y >= TILE_SIZE ? 1 : 0;
    for (let px = 0; px < PADDED_SIZE; ++px) {
      const x = px - DEPTH;
      const dx = x < 0 ? -1 : x >= TILE_SIZE ? 1 : 0;
      const neighbor = neighbors[(dy + 1) * 3 + dx + 1];
      padded[py * PADDED_SIZE + px] =
          neighbor
              ? edgeAt(neighbor, x - dx * TILE_SIZE, y - dy * TILE_SIZE)
              : meters[clampToTile(y) * TILE_SIZE + clampToTile(x)];
    }
  }
  return padded;
}

function clampToTile(v: number): number {
  return Math.min(Math.max(v, 0), TILE_SIZE - 1);
}

// Runs Horn's method, the same as gdaldem slope. Both tiles along an edge compute its slopes from
// the same elevations in the same order, so they agree to the bit.
// https://gdal.org/en/stable/programs/gdaldem.html#slope
function computeSlopes(id: TileId, padded: Float32Array): Uint8Array {
  const slopes = new Uint8Array(SLOPES_SIZE * SLOPES_SIZE);
  const world = TILE_SIZE * Math.pow(2, id.zoom);
  // The output starts a pixel before the tile and the padding starts DEPTH before it
  const shift = DEPTH - 1;
  for (let sy = 0; sy < SLOPES_SIZE; ++sy) {
    // Mercator pixels are square, and their side shrinks with the cosine of the latitude. Plus half
    // a pixel because a pixel's value sits at its center.
    const mercatorY = 1 - 2 * (id.y * TILE_SIZE + sy - 1 + 0.5) / world;
    const latitude = Math.atan(Math.sinh(Math.PI * mercatorY));
    const cellMeters = 2 * Math.PI * EARTH_RADIUS_METERS * Math.cos(latitude) / world;
    const above = (sy + shift - 1) * PADDED_SIZE;
    const row = (sy + shift) * PADDED_SIZE;
    const below = (sy + shift + 1) * PADDED_SIZE;
    for (let sx = 0; sx < SLOPES_SIZE; ++sx) {
      const w = sx + shift - 1;
      const c = sx + shift;
      const e = sx + shift + 1;
      const dzdx =
          (padded[above + e] + 2 * padded[row + e] + padded[below + e]
              - padded[above + w] - 2 * padded[row + w] - padded[below + w])
              / (8 * cellMeters);
      const dzdy =
          (padded[below + w] + 2 * padded[below + c] + padded[below + e]
              - padded[above + w] - 2 * padded[above + c] - padded[above + e])
              / (8 * cellMeters);
      const degrees = Math.atan(Math.hypot(dzdx, dzdy)) * 180 / Math.PI;
      slopes[sy * SLOPES_SIZE + sx] = Math.round(degrees / 90 * 255);
    }
  }
  return slopes;
}

// Loads tiles concurrently so that one waiting on its neighbors doesn't hold up the rest.
serveClients<undefined, Request, Response>((init, emit) => {
  const loader = new SlopeLoader(emit);
  return request => {
    if (request.kind === 'lr') {
      loader.load(request);
    } else {
      checkExhaustive(request.kind);
    }
  };
});
