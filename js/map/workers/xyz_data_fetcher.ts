import { S2LatLng, S2LatLngRect } from 'java/org/trailcatalog/s2';
import { checkExhaustive, checkExists } from 'external/dev_april_corgi+/js/common/asserts';
import { HashMap, HashSet } from 'external/dev_april_corgi+/js/common/collections';
import { Debouncer } from 'external/dev_april_corgi+/js/common/debouncer';
import { FetchThrottler } from 'external/dev_april_corgi+/js/common/fetch_throttler';
import { clamp } from 'external/dev_april_corgi+/js/common/math';

import { projectLatLngRect } from '../camera';
import { tilesIntersect } from '../common/math';
import { Rect, TileId } from '../common/types';

import { serveClients } from './client_pool';
import { Cone, selectTilesInCone, tileInCone } from './tile_cone';

// pi times the WGS84 semi-major axis of 6378137 m
const WEB_MERCATOR_HALF_WORLD_METERS = 20037508.342789244;

export interface Initialize {
  url: string;
  extraZoom: number;
  minZoom: number;
  maxZoom: number;
  // Lets the globe fetch each tile at the zoom its own spot on screen needs, for layers that can draw
  // tiles of different zooms side by side. See selectTilesInCone.
  perTileZoom?: boolean;
  // How many tiles may download at once, see fetch_throttler.ts#MAX_REQUESTS_IN_FLIGHT
  maxInFlight?: number;
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
  cone?: Cone;
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

export type Request = SetUrlRequest|TileLoadedRequest|UpdateViewportRequest;

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
      private readonly perTileZoom: boolean,
      maxInFlight: number|undefined,
      private readonly postMessage: (command: Command, transfer?: Transferable[]) => void,
  ) {
    this.inFlight = createTileHashMap();
    this.pending = createTileHashSet();
    this.loaded = createTileHashSet();
    this.throttler = new FetchThrottler(maxInFlight);
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

    const used = createTileHashSet();
    for (const id of this.visibleTiles(viewport)) {
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
    const used = createTileHashSet();
    for (const id of this.visibleTiles(checkExists(this.lastViewport))) {
      used.add(id);
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

  private visibleTiles(viewport: Viewport): TileId[] {
    if (this.perTileZoom && viewport.cone) {
      return selectTilesInCone(viewport.cone, this.extraZoom, this.minZoom, this.maxZoom);
    }

    const tz = clamp(Math.floor(viewport.zoom + this.extraZoom), 0, this.maxZoom);
    if (tz < this.minZoom) {
      return [];
    }
    const projected = projectViewport(viewport);
    const worldSize = Math.pow(2, tz);
    const tiles = [];
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
        if (tileInCone(id, worldSize, viewport.cone)) {
          tiles.push(id);
        }
      }
    }
    return tiles;
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

serveClients<Initialize, Request, Command>((init, emit) => {
  const fetcher =
      new XyzDataFetcher(
          init.url,
          init.extraZoom,
          init.minZoom,
          init.maxZoom,
          init.perTileZoom ?? false,
          init.maxInFlight,
          emit);
  return request => {
    if (request.kind === 'sur') {
      fetcher.setUrl(request);
    } else if (request.kind === 'tlr') {
      fetcher.tileLoaded(request);
    } else if (request.kind === 'uvr') {
      fetcher.updateViewport(request);
    } else {
      checkExhaustive(request);
    }
  };
});

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
