import { checkExhaustive, checkExists } from 'js/common/asserts';
import { HashSet } from 'js/common/collections';
import { FetchThrottler } from 'js/common/fetch_throttler';
import { clamp } from 'js/common/math';
import { Timer } from 'js/common/timer';

import { tilesIntersect } from '../common/math';
import { MbtileTile, TileId, Tileset, Vec2 } from '../common/types';

import { decodeMbtile } from './mbtile_decoder';

export interface SetTilesetRequest {
  type: 'str';
  tileset: Tileset;
}

export interface UpdateViewportRequest {
  type: 'uvr';
  cameraPosition: Vec2;
  cameraZoom: number;
  viewportSize: Vec2;
}

export type FetcherRequest = SetTilesetRequest|UpdateViewportRequest;

export interface Bitmap {
  id: TileId;
  bitmap: ImageBitmap;
}

export interface Mbtile {
  id: TileId;
  tile: MbtileTile;
}

export interface BatchedCommand {
  type: 'bc';
  bitmaps: Bitmap[];
  mbtiles: Mbtile[];
  unload: TileId[];
}

export interface NeverCommand {
  type: never;
}

export type FetcherCommand = BatchedCommand|NeverCommand;

const WEB_MERCATOR_TILE_SIZE_PX = 256;

class TileFetcher {

  private readonly inFlight: HashSet<TileId>;
  private readonly loaded: HashSet<TileId>;
  private readonly throttler: FetchThrottler;
  private lastUsed: HashSet<TileId>;
  private queuedBitmaps: Bitmap[];
  private queuedMbtiles: Mbtile[];
  private tileset: Tileset|undefined;

  constructor(
      postMessage: (response: FetcherCommand, transfer?: Transferable[]) => void,
  ) {
    this.inFlight = createTileHashSet();
    this.loaded = createTileHashSet();
    this.throttler = new FetchThrottler();
    this.lastUsed = createTileHashSet();
    this.queuedBitmaps = [];
    this.queuedMbtiles = [];
    this.tileset = undefined;

    // We want to set this high enough that the main thread has time to fully upload geometry and
    // render it. This prevents stalls.
    const timer = new Timer(200 /* ms */, () => {
      const unload = this.cull(this.lastUsed);
      const bitmaps = this.queuedBitmaps.filter(t => this.loaded.has(t.id));
      const mbtiles = this.queuedMbtiles.filter(t => this.loaded.has(t.id));

      const transferables = [];
      for (const bitmap of bitmaps) {
        transferables.push(bitmap.bitmap);
      }
      for (const mbtile of mbtiles) {
        transferables.push(mbtile.tile.geometry.buffer);
        transferables.push(mbtile.tile.indices.buffer);
      }

      postMessage({
        type: 'bc',
        bitmaps,
        mbtiles,
        unload,
      }, transferables);

      this.queuedBitmaps = [];
      this.queuedMbtiles = [];
    });
    timer.start();
  }

  setTileset(request: SetTilesetRequest): void {
    this.queuedBitmaps = [];
    this.queuedMbtiles = [];
    this.lastUsed.clear();
    this.cull(this.lastUsed);
    this.tileset = request.tileset;
  }

  updateViewport(request: UpdateViewportRequest): void {
    // World coordinates in this function are in tile pixels, not in screen pixels

    if (!this.tileset) {
      return;
    }

    const tileset = this.tileset;
    const tz =
        clamp(
            Math.floor(request.cameraZoom + tileset.extraZoom),
            0,
            tileset.maxZoom);
    if (tz < tileset.minZoom) {
      request.viewportSize[0] = -9999999;
      request.viewportSize[1] = -9999999;
    }

    const worldSize = Math.pow(2, tz);
    const halfWorldSize = worldSize / 2;
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
            // Handle world wrap
            x: (x + 3 * halfWorldSize) % worldSize - halfWorldSize,
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
            x: id.x + halfWorldSize,
            y: halfWorldSize - y,
            zoom: tz,
          };
          fetch(this.getTileUrl(urlId))
              .then(response => {
                if (response.ok) {
                  if (tileset.type === 'bitmap') {
                    return response.blob()
                        .then(blob => createImageBitmap(blob))
                        .then(bitmap => {
                          this.loaded.add(id);
                          this.queuedBitmaps.push({id, bitmap});
                        });
                  } else if (tileset.type === 'mbtile') {
                    return response.blob()
                        .then(blob => blob.arrayBuffer())
                        .then(data => {
                          this.loaded.add(id);
                          const tile = decodeMbtile(id, data);
                          this.queuedMbtiles.push({id, tile});
                        });
                  } else {
                    checkExhaustive(tileset);
                  }
                } else if (response.status === 404) {
                  this.loaded.add(id);
                } else {
                  throw new Error(`Failed to download tile ${id.x},${id.y} at ${id.zoom}`);
                }
              })
              .catch(e => {
                console.error(e);
                // This is probably a CORS error, make sure we don't request it again.
                this.loaded.add(id);
              })
              .finally(() => {
                this.inFlight.delete(id);
              });
      }
    }

    this.lastUsed = used;
  }

  private cull(used: HashSet<TileId>): TileId[] {
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

    return unloadIds;
  }

  private getTileUrl(id: TileId): string {
    return checkExists(this.tileset)
        .tileUrl
        .replace('${id.x}', String(id.x))
        .replace('${id.y}', String(id.y))
        .replace('${id.zoom}', String(id.zoom));
  }
}

const fetcher = new TileFetcher((self as any).postMessage.bind(self));
self.onmessage = e => {
  const request = e.data as FetcherRequest;
  if (request.type === 'str') {
    fetcher.setTileset(request);
  } else if (request.type === 'uvr') {
    fetcher.updateViewport(request);
  } else {
    checkExhaustive(request);
  }
};

function createTileHashSet(): HashSet<TileId> {
  return new HashSet(id => `${id.x},${id.y},${id.zoom}`);
}

