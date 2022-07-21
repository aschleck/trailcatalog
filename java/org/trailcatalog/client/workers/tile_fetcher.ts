import { HashSet } from '../common/collections';
import { TileId, Vec2 } from '../common/types';

import { FetchThrottler } from './fetch_throttler';

const TILE_SOURCES = {
  maptiler: {
    extraZoom: -1, // we're using the 512x512px tiles
    getTileUrl: (id: TileId) =>
        `https://api.maptiler.com/maps/topo/${id.zoom}/${id.x}/${id.y}.png?` +
            `key=wWxlJy7a8SEPXS7AZ42l`,
  },
  thunderforest: {
    extraZoom: 0,
    getTileUrl: (id: TileId) =>
        `https://tile.thunderforest.com/landscape/${id.zoom}/${id.x}/${id.y}.png?` +
            `apikey=d72e980f5f1849fbb9fb3a113a119a6f`,
  },
} as const;

const TILE_SET = TILE_SOURCES.maptiler;

const WEB_MERCATOR_TILE_SIZE_PX = 256;

export interface UpdateViewportRequest {
  cameraPosition: Vec2;
  cameraZoom: number;
  viewportSize: Vec2;
}

export interface LoadTileCommand {
  type: 'ltc';
  id: TileId;
  bitmap: ImageBitmap;
}

export interface UnloadTilesCommand {
  type: 'utc';
  ids: TileId[];
}

export type FetcherCommand = LoadTileCommand|UnloadTilesCommand;

class TileFetcher {

  private readonly inFlight: HashSet<TileId>;
  private readonly loaded: HashSet<TileId>;
  private readonly throttler: FetchThrottler;
  private lastUsed: HashSet<TileId>;

  constructor(
      private readonly mail:
          (response: FetcherCommand, transfer?: Transferable[]) => void) {
    this.inFlight = createTileHashSet();
    this.loaded = createTileHashSet();
    this.throttler = new FetchThrottler();
    this.lastUsed = createTileHashSet();
  }

  updateViewport(request: UpdateViewportRequest): void {
    // World coordinates in this function are in tile pixels, not in screen pixels

    const tz = Math.floor(request.cameraZoom + TILE_SET.extraZoom);
    const halfWorldSize = Math.pow(2, tz - 1); // - 1 gives us the half
    const center = request.cameraPosition;
    const centerInWorldPx = [center[0] * halfWorldSize, center[1] * halfWorldSize];
    const doubleSize = WEB_MERCATOR_TILE_SIZE_PX * Math.pow(2, request.cameraZoom - tz + 1);
    const halfViewportInWorldPx = [
      request.viewportSize[0] / doubleSize,
      request.viewportSize[1] / doubleSize,
    ];

    const used = createTileHashSet();
    // We need to add 1 to y tiles because our coordinate system is flipped from the typical
    // coordinates.
    for (let y = Math.floor(centerInWorldPx[1] - halfViewportInWorldPx[1]);
         y < centerInWorldPx[1] + halfViewportInWorldPx[1] + 1;
         ++y) {
       for (let x = Math.floor(centerInWorldPx[0] - halfViewportInWorldPx[0]);
            x < centerInWorldPx[0] + halfViewportInWorldPx[0];
            ++x) {
          const id = {
            x,
            y,
            zoom: tz,
          };
          used.add(id);
          if (this.inFlight.has(id) || this.loaded.has(id)) {
            continue;
          }

          this.inFlight.add(id);
          // We use coordinates from -1 to 1 but servers use 0 to 1.
          const urlId = {
            x: x + halfWorldSize,
            y: halfWorldSize - y,
            zoom: tz,
          };
          fetch(TILE_SET.getTileUrl(urlId))
              .then(response => {
                if (response.ok) {
                  return response.blob()
                      .then(blob => createImageBitmap(blob))
                      .then(bitmap => {
                        this.loaded.add(id);
                        this.mail({
                          type: 'ltc',
                          id,
                          bitmap,
                        }, [bitmap]);
                      });
                } else if (response.status === 404) {
                  this.loaded.add(id);
                } else {
                  throw new Error(`Failed to download tile ${id.x},${id.y} at ${id.zoom}`);
                }
              })
              .catch(e => {
                console.error(e);
              })
              .finally(() => {
                this.inFlight.delete(id);
                this.cull(this.lastUsed);
              });
      }
    }

    this.lastUsed = used;
    this.cull(used);
  }

  private cull(used: HashSet<TileId>): void {
    const unloadIds = [];
    for (const id of this.loaded) {
      if (used.has(id)) {
        continue;
      }

      let useful = false;
      for (const missing of this.inFlight) {
        if (tilesIntersect(id, missing)) {
          useful = true;
          break;
        }
      }
      if (useful) {
        continue;
      }

      this.loaded.delete(id);
      unloadIds.push(id);
    }
    this.mail({
      type: 'utc',
      ids: unloadIds,
    });
  }
}

const fetcher = new TileFetcher((self as any).postMessage.bind(self));
self.onmessage = e => {
  const request = e.data as UpdateViewportRequest;
  fetcher.updateViewport(request);
};

function createTileHashSet(): HashSet<TileId> {
  return new HashSet(id => `${id.x},${id.y},${id.zoom}`);
}

function tilesIntersect(a: TileId, b: TileId): boolean {
  if (a.zoom > b.zoom) {
    return tilesIntersect(b, a);
  }

  const dz = a.zoom - b.zoom;
  const p2 = Math.pow(2, dz);
  const bx = Math.floor(b.x * p2);
  const by = Math.ceil(b.y * p2);
  return a.x === bx && a.y === by;
}

