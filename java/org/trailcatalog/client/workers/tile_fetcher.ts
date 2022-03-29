import { SimpleS2 } from 'java/org/trailcatalog/s2/SimpleS2';

import { HashSet } from '../common/collections';
import { TileId, Vec2 } from '../common/types';

import { FetchThrottler } from './fetch_throttler';

const TILE_SIZE_PX = 256;

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

  constructor(
      private readonly mail:
          (response: FetcherCommand, transfer?: Transferable[]) => void) {
    this.inFlight = createTileHashSet();
    this.loaded = createTileHashSet();
    this.throttler = new FetchThrottler();
  }

  updateViewport(request: UpdateViewportRequest): void {
    // World coordinates in this function are in tile pixels, not in screen pixels

    const extraZoom = 0;
    const tz = Math.floor(request.cameraZoom + extraZoom);
    const halfWorldSize = Math.pow(2, tz - 1); // - 1 gives us the half
    const center = request.cameraPosition;
    const centerInWorldPx = [center[0] * halfWorldSize, center[1] * halfWorldSize];
    const doubleSize = TILE_SIZE_PX * Math.pow(2, request.cameraZoom - tz + 1);
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
          fetch(urlFor(urlId))
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
              });
      }
    }

    const unloadIds = [];
    for (const id of this.loaded) {
      if (used.has(id)) {
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

function urlFor(id: TileId): string {
  return `https://tile.thunderforest.com/landscape/${id.zoom}/${id.x}/${id.y}.png?` +
      `apikey=d72e980f5f1849fbb9fb3a113a119a6f`;
}
