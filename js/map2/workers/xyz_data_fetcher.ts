import { S2LatLng, S2LatLngRect } from 'java/org/trailcatalog/s2';
import { checkExhaustive } from 'js/common/asserts';
import { HashMap, HashSet } from 'js/common/collections';
import { Debouncer } from 'js/common/debouncer';
import { FetchThrottler } from 'js/common/fetch_throttler';
import { clamp } from 'js/common/math';

import { projectLatLngRect } from '../camera';
import { tilesIntersect } from '../common/math';
import { TileId } from '../common/types';

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
}

interface UpdateViewportRequest {
  kind: 'uvr';
  viewport: Viewport;
}

export type Request = InitializeRequest|TileLoadedRequest|UpdateViewportRequest;

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
  private lastViewport: Viewport;

  constructor(
      private readonly url: string,
      private readonly extraZoom: number,
      private readonly minZoom: number,
      private readonly maxZoom: number,
      private readonly postMessage: (command: Command, transfer?: Transferable[]) => void,
  ) {
    this.inFlight = createTileHashMap();
    this.pending = createTileHashSet();
    this.loaded = createTileHashSet();
    this.throttler = new FetchThrottler();
    this.lastViewport = {
      lat: [1, -1],
      lng: [1, -1],
      zoom: 31,
    };
  }

  tileLoaded(request: TileLoadedRequest): void {
    if (this.pending.has(request.id)) {
      this.pending.delete(request.id);
      this.loaded.add(request.id);
    }
  }

  updateViewport(request: UpdateViewportRequest): void {
    const viewport = request.viewport;
    this.lastViewport = viewport;

    const low = S2LatLng.fromRadians(viewport.lat[0], viewport.lng[0]);
    const high = S2LatLng.fromRadians(viewport.lat[1], viewport.lng[1]);
    const bounds = S2LatLngRect.fromPointPair(low, high);
    let projected = projectLatLngRect(bounds);
    if (projected.low[0] > projected.high[0]) {
      projected = {
        low: [projected.high[0], projected.low[1]],
        high: [projected.low[0], projected.high[1]],
      };
    }

    const tz = clamp(Math.floor(viewport.zoom + this.extraZoom), 0, this.maxZoom);
    const worldSize = Math.pow(2, tz);
    const halfWorldSize = worldSize / 2;

    const used = createTileHashSet();
    // projected goes from -1 to 1, so we divide by 2 and add 0.5 to make it 0 to 1.
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
            .catch(e => {
              if (e.name !== 'AbortError') {
                console.error(e);
              }
              return new ArrayBuffer(0);
            })
            .then(data => {
              this.pending.add(id);
              this.postMessage({
                kind: 'ltc',
                id,
                data,
              }, [data]);
              this.cull();
            })
            .finally(() => {
              this.inFlight.delete(id);

              if (this.inFlight.size === 0) {
                this.postMessage({
                  kind: 'usc',
                  fetching: this.inFlight.size > 0,
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

    this.postMessage({
      kind: 'usc',
      fetching: this.inFlight.size > 0,
    });
  }

  private cull(): void {
    const viewport = this.lastViewport;

    const low = S2LatLng.fromRadians(viewport.lat[0], viewport.lng[0]);
    const high = S2LatLng.fromRadians(viewport.lat[1], viewport.lng[1]);
    const bounds = S2LatLngRect.fromPointPair(low, high);
    let projected = projectLatLngRect(bounds);
    if (projected.low[0] > projected.high[0]) {
      projected = {
        low: [projected.high[0], projected.low[1]],
        high: [projected.low[0], projected.high[1]],
      };
    }

    const tz = clamp(Math.floor(viewport.zoom + this.extraZoom), 0, this.maxZoom);
    const worldSize = Math.pow(2, tz);
    const halfWorldSize = worldSize / 2;

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
    return this.url
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

function createTileHashMap<V>(): HashMap<TileId, V> {
  return new HashMap(id => `${id.x},${id.y},${id.zoom}`);
}

function createTileHashSet(): HashSet<TileId> {
  return new HashSet(id => `${id.x},${id.y},${id.zoom}`);
}

