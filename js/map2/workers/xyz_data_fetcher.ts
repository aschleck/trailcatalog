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

interface Viewport {
  lat: [number, number];
  lng: [number, number];
  zoom: number;
}

interface UpdateViewportRequest {
  kind: 'uvr';
  viewport: Viewport;
}

export type Request = InitializeRequest|UpdateViewportRequest;

export interface LoadTileCommand {
  kind: 'ltc';
  id: TileId;
  data: ArrayBuffer;
}

export interface UnloadTilesCommand {
  kind: 'utc';
  ids: TileId[];
}

export type Command = LoadTileCommand|UnloadTilesCommand;

class XyzDataFetcher {

  private readonly inFlight: HashMap<TileId, AbortController>;
  private readonly loaded: HashSet<TileId>;
  private readonly throttler: FetchThrottler;

  constructor(
      private readonly url: string,
      private readonly extraZoom: number,
      private readonly minZoom: number,
      private readonly maxZoom: number,
      private readonly postMessage: (command: Command, transfer?: Transferable[]) => void,
  ) {
    this.inFlight = createTileHashMap();
    this.loaded = createTileHashSet();
    this.throttler = new FetchThrottler();
  }

  updateViewport(request: UpdateViewportRequest) {
    const viewport = request.viewport;
    const low = S2LatLng.fromRadians(viewport.lat[0], viewport.lng[0]);
    const high = S2LatLng.fromRadians(viewport.lat[1], viewport.lng[1]);
    const bounds = S2LatLngRect.fromPointPair(low, high);
    const projected = projectLatLngRect(bounds);

    const tz =
        clamp(
            Math.floor(request.viewport.zoom + this.extraZoom),
            0,
            this.maxZoom);

    const worldSize = Math.pow(2, tz);
    const halfWorldSize = worldSize / 2;

    const used = createTileHashSet();
    for (let y = Math.floor(worldSize * (-projected.high[1] / 2 + 0.5));
         y < worldSize * (-projected.low[1] / 2 + 0.5);
         ++y) {
      for (let x = Math.floor(worldSize * (projected.low[0] / 2 + 0.5));
          x < worldSize * (projected.high[0] / 2 + 0.5);
          ++x) {
        const id = {
          // Handle world wrap
          x: (x + 3 * halfWorldSize) % worldSize - halfWorldSize,
          y,
          zoom: tz,
        };
        used.add(id);

        if (this.loaded.has(id) || this.inFlight.has(id)) {
          continue;
        }

        const abort = new AbortController();
        this.inFlight.set(id, abort);

        this.throttler.fetch(this.getTileUrl(id), { mode: 'cors', signal: abort.signal })
            .then(response => {
              if (response.ok) {
                return response.arrayBuffer();
              } else {
                throw new Error(`Failed to download tile ${id.x},${id.y} at ${id.zoom}`);
              }
            })
            .then(data => {
              this.loaded.add(id);
              this.postMessage({
                kind: 'ltc',
                id,
                data,
              }, [data]);
            })
            .catch(e => {
              if (e.name !== 'AbortError') {
                throw e;
              }
            })
            .finally(() => {
              this.inFlight.delete(id);
            });
      }
    }

    for (const [id, abort] of this.inFlight) {
      if (!used.has(id)) {
        abort.abort();
        this.inFlight.delete(id);
      }
    }

    const unload = [];
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

