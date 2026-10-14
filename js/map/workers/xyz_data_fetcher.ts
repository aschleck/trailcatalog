import { S2LatLng, S2LatLngRect } from 'java/org/trailcatalog/s2';
import { checkExhaustive, checkExists } from 'external/dev_april_corgi+/js/common/asserts';
import { HashMap, HashSet } from 'external/dev_april_corgi+/js/common/collections';
import { Debouncer } from 'external/dev_april_corgi+/js/common/debouncer';
import { FetchThrottler } from 'external/dev_april_corgi+/js/common/fetch_throttler';
import { clamp } from 'external/dev_april_corgi+/js/common/math';

import { projectLatLngRect } from '../camera';
import { tilesIntersect } from '../common/math';
import { Rect, TileId } from '../common/types';

// pi times the WGS84 semi-major axis of 6378137 m
const WEB_MERCATOR_HALF_WORLD_METERS = 20037508.342789244;

interface InitializeRequest {
  kind: 'ir';
  url: string;
  extraZoom: number;
  minZoom: number;
  maxZoom: number;
}

interface TileLoadedRequest {
  kind: 'tlr';
  id: TileId;
}

interface Viewport {
  lat: [number, number];
  lng: [number, number];
  zoom: number;
  // Optional spherical visibility cone. When present, only tiles whose
  // nearest spherical point P satisfies dot(P, camDir) >= cosThetaT are
  // fetched. In fully-flat (mercator) mode this is omitted so the lat/lng
  // rectangle alone defines visibility.
  cone?: {
    camDir: [number, number, number];
    cosThetaT: number;
  };
}

interface UpdateViewportRequest {
  kind: 'uvr';
  viewport: Viewport;
}

// Switches to a different tile URL, such as another day's, and unloads all tiles from the old one.
interface SetUrlRequest {
  kind: 'sur';
  url: string;
}

export type Request = InitializeRequest|SetUrlRequest|TileLoadedRequest|UpdateViewportRequest;

export interface LoadTileCommand {
  kind: 'ltc';
  id: TileId;
  data: ArrayBuffer;
}

export interface UnloadTilesCommand {
  kind: 'utc';
  ids: TileId[];
}

export interface UpdateStateCommand {
  kind: 'usc';
  fetching: boolean;
}

export type Command = LoadTileCommand|UnloadTilesCommand|UpdateStateCommand;

class XyzDataFetcher {

  private readonly inFlight: HashMap<TileId, AbortController>;
  private readonly pending: HashSet<TileId>;
  private readonly loaded: HashSet<TileId>;
  private readonly throttler: FetchThrottler;
  private lastViewport: Viewport|undefined;

  constructor(
      private url: string,
      private readonly extraZoom: number,
      private readonly minZoom: number,
      private readonly maxZoom: number,
      private readonly postMessage: (command: Command, transfer?: Transferable[]) => void,
  ) {
    this.inFlight = createTileHashMap();
    this.pending = createTileHashSet();
    this.loaded = createTileHashSet();
    this.throttler = new FetchThrottler();
    this.lastViewport = undefined;
  }

  tileLoaded(request: TileLoadedRequest): void {
    if (this.pending.has(request.id)) {
      this.pending.delete(request.id);
      this.loaded.add(request.id);
    }
  }

  setUrl(request: SetUrlRequest): void {
    this.url = request.url;
    for (const abort of this.inFlight.values()) {
      abort.abort();
    }
    this.inFlight.clear();
    const unload = [...this.pending, ...this.loaded];
    this.pending.clear();
    this.loaded.clear();
    if (unload.length > 0) {
      this.postMessage({
        kind: 'utc',
        ids: unload,
      });
    }
    // A layer that was never shown has no viewport to fetch for
    if (this.lastViewport) {
      this.updateViewport({kind: 'uvr', viewport: this.lastViewport});
    }
  }

  updateViewport(request: UpdateViewportRequest): void {
    const viewport = request.viewport;
    this.lastViewport = viewport;

    let projected = projectViewport(viewport);

    const tz = clamp(Math.floor(viewport.zoom + this.extraZoom), 0, this.maxZoom);
    if (tz < this.minZoom) {
      projected = {low: [1, 1], high: [-1, -1]};
    }
    const worldSize = Math.pow(2, tz);

    const used = createTileHashSet();
    // projected goes from -1 to 1, so we divide by 2 and add 0.5 to make it 0 to 1.
    // We also flip y because tile indices increase top-to-bottom.
    for (let y = Math.floor(worldSize * (-projected.high[1] / 2 + 0.5));
         y < worldSize * (-projected.low[1] / 2 + 0.5);
         ++y) {
      for (let x = Math.floor(worldSize * (projected.low[0] / 2 + 0.5));
          x < worldSize * (projected.high[0] / 2 + 0.5);
          ++x) {
        if (y < 0 || y >= worldSize) {
          continue;
        }

        const id = {
          // Handle world wrap. 3 is just a number that seems large enough to force x positive.
          x: (x + 3 * worldSize) % worldSize,
          y,
          zoom: tz,
        };
        if (!tileInCone(id, worldSize, viewport.cone)) {
          continue;
        }
        used.add(id);

        if (this.inFlight.has(id) || this.pending.has(id) || this.loaded.has(id)) {
          continue;
        }

        const abort = new AbortController();
        this.inFlight.set(id, abort);

        this.throttler.fetch(this.getTileUrl(id), { mode: 'cors', signal: abort.signal })
            .then(response => {
              if (response.ok) {
                return response.arrayBuffer();
              } else {
                throw new Error(
                    `Failed to download tile ${id.x},${id.y} at ${id.zoom} `
                        + `(status ${response.status}`);
              }
            })
            .then(data => {
              // setUrl was called after this download finished, so it's a tile from the old URL.
              if (this.inFlight.get(id) !== abort) {
                return;
              }
              this.pending.add(id);
              this.postMessage({
                kind: 'ltc',
                id,
                data,
              }, [data]);
              this.cull();
            })
            .catch(e => {
              // Forget an aborted tile so panning back fetches it again. Count one we can't
              // download as loaded, or else every sibling that lands asks for it again.
              if (e.name !== 'AbortError') {
                console.error(e);
                this.loaded.add(id);
              }
            })
            .finally(() => {
              // Only clear the slot if it is still ours. An abort drops out of inFlight before it
              // unwinds, so a second request for the same tile may hold it by now, and clearing
              // that one reports idle while it is still running.
              if (this.inFlight.get(id) !== abort) {
                return;
              }
              this.inFlight.delete(id);

              if (this.inFlight.size === 0) {
                this.postMessage({
                  kind: 'usc',
                  fetching: false,
                });
              }
            });
      }
    }

    for (const [id, abort] of this.inFlight) {
      if (!used.has(id)) {
        abort.abort();
        this.inFlight.delete(id);
      }
    }

    // For reasons I don't care to understand, when the user zooms all the way out and then all the
    // way in we don't unload the low zoom tiles. This seems to help, albeit late.
    this.cull();

    this.postMessage({
      kind: 'usc',
      fetching: this.inFlight.size > 0,
    });
  }

  private cull(): void {
    const viewport = checkExists(this.lastViewport);

    let projected = projectViewport(viewport);

    const tz = clamp(Math.floor(viewport.zoom + this.extraZoom), 0, this.maxZoom);
    const worldSize = Math.pow(2, tz);

    const used = createTileHashSet();
    // projected goes from -1 to 1, so we divide by 2 and add 0.5 to make it 0 to 1.
    for (let y = Math.floor(worldSize * (-projected.high[1] / 2 + 0.5));
         y < worldSize * (-projected.low[1] / 2 + 0.5);
         ++y) {
      for (let x = Math.floor(worldSize * (projected.low[0] / 2 + 0.5));
          x < worldSize * (projected.high[0] / 2 + 0.5);
          ++x) {
        const id = {
          // Handle world wrap. 3 is just a number that seems large enough to force x positive.
          x: (x + 3 * worldSize) % worldSize,
          y,
          zoom: tz,
        };
        if (!tileInCone(id, worldSize, viewport.cone)) {
          continue;
        }
        used.add(id);
      }
    }

    const unload = [];
    for (const id of this.pending) {
      if (used.has(id)) {
        continue;
      }

      let useful = false;
      for (const missing of this.inFlight.keys()) {
        if (tilesIntersect(id, missing)) {
          useful = true;
          break;
        }
      }
      if (useful) {
        continue;
      }

      this.pending.delete(id);
      unload.push(id);
    }

    for (const id of this.loaded) {
      if (used.has(id)) {
        continue;
      }

      let useful = false;
      for (const missing of this.inFlight.keys()) {
        if (tilesIntersect(id, missing)) {
          useful = true;
          break;
        }
      }
      if (useful) {
        continue;
      }
      for (const missing of this.pending) {
        if (tilesIntersect(id, missing)) {
          useful = true;
          break;
        }
      }
      if (useful) {
        continue;
      }

      this.loaded.delete(id);
      unload.push(id);
    }

    if (unload.length > 0) {
      this.postMessage({
        kind: 'utc',
        ids: unload,
      });
    }
  }

  private getTileUrl(id: TileId): string {
    // ArcGIS export and WMS servers render any box you ask for instead of serving fixed tiles, so we
    // pass the tile's bounds in EPSG:3857 meters as xmin,ymin,xmax,ymax.
    const size = 2 * WEB_MERCATOR_HALF_WORLD_METERS / Math.pow(2, id.zoom);
    const left = -WEB_MERCATOR_HALF_WORLD_METERS + id.x * size;
    const top = WEB_MERCATOR_HALF_WORLD_METERS - id.y * size;
    return this.url
        .replace('${bbox}', `${left},${top - size},${left + size},${top}`)
        .replace('${id.x}', String(id.x))
        .replace('${id.y}', String(id.y))
        .replace('${id.zoom}', String(id.zoom));
  }
}

function start(ir: InitializeRequest) {
  const fetcher =
      new XyzDataFetcher(
          ir.url,
          ir.extraZoom,
          ir.minZoom,
          ir.maxZoom,
          (self as any).postMessage.bind(self));
  self.onmessage = e => {
    const request = e.data as Request;
    if (request.kind === 'ir') {
      throw new Error('Already initialized');
    } else if (request.kind === 'sur') {
      fetcher.setUrl(request);
    } else if (request.kind === 'tlr') {
      fetcher.tileLoaded(request);
    } else if (request.kind === 'uvr') {
      fetcher.updateViewport(request);
    } else {
      checkExhaustive(request);
    }
  };
}

self.onmessage = e => {
  const request = e.data as Request;
  if (request.kind !== 'ir') {
    throw new Error('Expected an initialization request');
  }

  start(request);
};

function projectViewport(viewport: Viewport): Rect {
  const low = S2LatLng.fromRadians(viewport.lat[0], viewport.lng[0]);
  const high = S2LatLng.fromRadians(viewport.lat[1], viewport.lng[1]);
  const projected = projectLatLngRect(S2LatLngRect.fromPointPair(low, high));
  // fromPointPair takes -pi and pi as the same point, so a viewport around a pole would span no
  // longitude at all.
  if (viewport.lng[1] - viewport.lng[0] >= 2 * Math.PI) {
    return {low: [-1, projected.low[1]], high: [1, projected.high[1]]};
  } else if (projected.low[0] > projected.high[0]) {
    return {
      low: [projected.high[0], projected.low[1]],
      high: [projected.low[0], projected.high[1]],
    };
  } else {
    return projected;
  }
}

function createTileHashMap<V>(): HashMap<TileId, V> {
  return new HashMap(id => `${id.x},${id.y},${id.zoom}`);
}

function createTileHashSet(): HashSet<TileId> {
  return new HashSet(id => `${id.x},${id.y},${id.zoom}`);
}

// Returns true if the tile's geographic patch intersects the camera's
// visible cap. The cap is the set of unit-sphere points P with
// dot(P, camDir) >= cosThetaT, so we maximize dot(P, camDir) over the patch.
//
// dot(P, camDir) = cos(lat) cos(camLat) cos(dLng) + sin(lat) sin(camLat).
// cos(lat) cos(camLat) is never negative, so the dot only grows as dLng
// shrinks and the best longitude is the patch's nearest to camLng at any
// latitude. With dLng fixed, the dot is a sinusoid in lat peaking at
// atan2(sin(camLat), cos(camLat) cos(dLng)), which is camLat only when dLng is
// 0. Clamping camLat instead picks the far edge of a tile across the pole.
function tileInCone(id: TileId, worldSize: number, cone?: Viewport['cone']): boolean {
  if (!cone) {
    return true;
  }
  const PI = Math.PI;
  const mx0 = (id.x / worldSize) * 2 - 1;
  const mx1 = ((id.x + 1) / worldSize) * 2 - 1;
  // Tile y indices go top-to-bottom but mercator y goes bottom-to-top.
  const myHigh = 1 - (id.y / worldSize) * 2;
  const myLow = 1 - ((id.y + 1) / worldSize) * 2;
  const lng0 = mx0 * PI;
  const lng1 = mx1 * PI;
  const lat0 = Math.asin(Math.tanh(myLow * PI));
  const lat1 = Math.asin(Math.tanh(myHigh * PI));

  const camLat = Math.asin(Math.max(-1, Math.min(1, cone.camDir[1])));
  const camLng = Math.atan2(cone.camDir[2], cone.camDir[0]);
  // in [0, 2pi), how far east of the tile's west edge the camera sits
  const east = ((camLng - lng0) % (2 * PI) + 2 * PI) % (2 * PI);
  const dLng = east <= lng1 - lng0 ? 0 : Math.min(east - (lng1 - lng0), 2 * PI - east);

  const dot = (lat: number) =>
      Math.cos(lat) * Math.cos(camLat) * Math.cos(dLng) + Math.sin(lat) * Math.sin(camLat);
  const bestLat = Math.atan2(Math.sin(camLat), Math.cos(camLat) * Math.cos(dLng));
  // The peak can sit past a pole, where the nearer edge around the circle isn't the one a clamp
  // picks, so outside the patch we try both edges.
  const d = lat0 <= bestLat && bestLat <= lat1 ? dot(bestLat) : Math.max(dot(lat0), dot(lat1));
  return d >= cone.cosThetaT;
}

