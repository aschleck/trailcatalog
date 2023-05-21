import { checkExhaustive } from 'js/common/asserts';
import { HashMap } from 'js/common/collections';
import { deepEqual } from 'js/common/comparisons';
import { Disposable } from 'js/common/disposable';
import { EmptyDeps } from 'js/corgi/deps';
import { Service, ServiceResponse } from 'js/corgi/service';

import { DPI_ZOOM } from '../common/dpi';
import { BitmapTileset, MbtileTile, MbtileTileset, TileId, Tileset, Vec2 } from '../common/types';
import { FetcherCommand } from '../workers/tile_fetcher';

interface BitmapListener {
  tilesChanged(load: Array<[TileId, ImageBitmap]>, unload: TileId[]): void;
}

interface BitmapStream {
  fetcher: Worker;
  listener: BitmapListener|undefined;
  tiles: HashMap<TileId, ImageBitmap>;
}

interface MbtileListener {
  tilesChanged(load: Array<[TileId, MbtileTile]>, unload: TileId[]): void;
}

interface MbtileStream {
  fetcher: Worker;
  listener: MbtileListener|undefined;
  tiles: HashMap<TileId, MbtileTile>;
}

export class TileDataService extends Service<EmptyDeps> {

  private readonly bitmapStreams: Map<Tileset, BitmapStream>;
  private readonly mbtileStreams: Map<Tileset, MbtileStream>;
  private lastViewport: readonly [Vec2, Vec2, number];

  constructor(response: ServiceResponse<EmptyDeps>) {
    super(response);
    this.bitmapStreams = new Map();
    this.mbtileStreams = new Map();
    this.lastViewport = [[0, 0], [0, 0], -1];
  }

  streamBitmaps(tileset: BitmapTileset, listener: BitmapListener): Disposable {
    let stream = this.bitmapStreams.get(tileset);
    if (!stream) {
      const fetcher = new Worker('/static/tile_fetcher_worker.js');
      fetcher.postMessage({
        type: 'str',
        tileset,
      });

      const tiles = new HashMap<TileId, ImageBitmap>(id => `${id.x},${id.y},${id.zoom}`);
      const constStream = {
        fetcher,
        listener,
        tiles,
      };
      stream = constStream;
      this.bitmapStreams.set(tileset, stream);

      fetcher.onmessage = e => {
        const command = e.data as FetcherCommand;
        if (command.type === 'bc') {
          for (const {id, bitmap} of command.bitmaps) {
            tiles.set(id, bitmap);
          }

          for (const id of command.unload) {
            tiles.delete(id);
          }

          constStream.listener?.tilesChanged(
              command.bitmaps.map(b => [b.id, b.bitmap]), command.unload);
        } else {
          checkExhaustive(command, 'Unknown type of command');
        }
      };
    }

    stream.listener = listener;
    listener.tilesChanged([...stream.tiles], []);

    const disposable = new Disposable();
    const constOriginalListener = listener;
    const constStream = stream;
    disposable.registerDisposer(() => {
      if (constStream.listener === constOriginalListener) {
        constStream.listener = undefined;
      }
    });
    return disposable;
  }

  streamMbtiles(tileset: MbtileTileset, listener: MbtileListener): Disposable {
    let stream = this.mbtileStreams.get(tileset);
    if (!stream) {
      const fetcher = new Worker('/static/tile_fetcher_worker.js');
      fetcher.postMessage({
        type: 'str',
        tileset,
      });

      const tiles = new HashMap<TileId, MbtileTile>(id => `${id.x},${id.y},${id.zoom}`);
      const constStream = {
        fetcher,
        listener,
        tiles,
      };
      stream = constStream;
      this.mbtileStreams.set(tileset, stream);

      fetcher.onmessage = e => {
        const command = e.data as FetcherCommand;
        if (command.type === 'bc') {
          for (const {id, tile} of command.mbtiles) {
            tiles.set(id, tile);
          }

          for (const id of command.unload) {
            tiles.delete(id);
          }

          constStream.listener?.tilesChanged(
              command.mbtiles.map(b => [b.id, b.tile]), command.unload);
        } else {
          checkExhaustive(command, 'Unknown type of command');
        }
      };
    }

    stream.listener = listener;
    listener.tilesChanged([...stream.tiles], []);

    const disposable = new Disposable();
    const constStream = stream;
    disposable.registerDisposer(() => {
      constStream.listener = undefined;
    });
    return disposable;
  }

  updateViewport(center: Vec2, viewportSize: Vec2, zoom: number): void {
    const current = [center, viewportSize, zoom] as const;
    if (deepEqual(this.lastViewport, current)) {
      return;
    }

    this.lastViewport = current;

    for (const stream of this.bitmapStreams.values()) {
      stream.fetcher.postMessage({
        cameraPosition: center,
        cameraZoom: zoom + DPI_ZOOM,
        type: 'uvr',
        viewportSize,
      });
    }

    for (const stream of this.mbtileStreams.values()) {
      stream.fetcher.postMessage({
        cameraPosition: center,
        cameraZoom: zoom + DPI_ZOOM,
        type: 'uvr',
        viewportSize,
      });
    }
  }
}

