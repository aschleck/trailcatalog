import { checkExhaustive, checkExists } from 'js/common/asserts';
import { HashSet } from 'js/common/collections';
import { FetchThrottler } from 'js/common/fetch_throttler';
import { clamp } from 'js/common/math';

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

export interface LoadBitmapCommand {
  type: 'lbc';
  id: TileId;
  bitmap: ImageBitmap;
}

export interface LoadMbtileCommand {
  type: 'lmc';
  id: TileId;
  tile: MbtileTile;
}

export interface UnloadTilesCommand {
  type: 'utc';
  ids: TileId[];
}

export type FetcherCommand = LoadBitmapCommand|LoadMbtileCommand|UnloadTilesCommand;

const WEB_MERCATOR_TILE_SIZE_PX = 256;

class TileFetcher {

  private readonly inFlight: HashSet<TileId>;
  private readonly loaded: HashSet<TileId>;
  private readonly throttler: FetchThrottler;
  private lastUsed: HashSet<TileId>;
  private tileset: Tileset|undefined;

  constructor(
      private readonly mail:
          (response: FetcherCommand, transfer?: Transferable[]) => void) {
    this.inFlight = createTileHashSet();
    this.loaded = createTileHashSet();
    this.throttler = new FetchThrottler();
    this.lastUsed = createTileHashSet();
    this.tileset = undefined;
  }

  setTileset(request: SetTilesetRequest): void {
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
                          this.mail({
                            type: 'lbc',
                            id,
                            bitmap,
                          }, [bitmap]);
                        });
                  } else if (tileset.type === 'mbtile') {
                    return response.blob()
                        .then(blob => blob.arrayBuffer())
                        .then(data => {
                          this.loaded.add(id);
                          const tile = decodeMbtile(id, data);
                          this.mail({
                            type: 'lmc',
                            id,
                            tile,
                          }, [tile.geometry.buffer, tile.indices.buffer]);
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
    if (unloadIds.length > 0) {
      this.mail({
        type: 'utc',
        ids: unloadIds,
      });
    }
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

