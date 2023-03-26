import { checkExhaustive } from 'js/common/asserts';
import { HashMap } from 'js/common/collections';
import { Disposable } from 'js/common/disposable';
import { EmptyDeps } from 'js/corgi/deps';
import { Service, ServiceResponse } from 'js/corgi/service';

import { DPI_ZOOM } from '../common/dpi';
import { BitmapTileset, TileId, Tileset, Vec2, VectorTileset } from '../common/types';
import { FetcherCommand } from '../workers/tile_fetcher';

interface BitmapListener {
  loadTile(id: TileId, bitmap: ImageBitmap): void;
  unloadTiles(ids: TileId[]): void;
}

interface BitmapStream {
  fetcher: Worker;
  listener: BitmapListener|undefined;
  tiles: HashMap<TileId, ImageBitmap>;
}

interface VectorListener {
  loadTile(id: TileId, data: ArrayBuffer): void;
  unloadTiles(ids: TileId[]): void;
}

interface VectorStream {
  fetcher: Worker;
  listener: VectorListener|undefined;
  tiles: HashMap<TileId, ArrayBuffer>;
}

export class TileDataService extends Service<EmptyDeps> {

  private readonly bitmapStreams: Map<Tileset, BitmapStream>;
  private readonly vectorStreams: Map<Tileset, VectorStream>;

  constructor(response: ServiceResponse<EmptyDeps>) {
    super(response);
    this.bitmapStreams = new Map();
    this.vectorStreams = new Map();
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
        if (command.type === 'lbc') {
          tiles.set(command.id, command.bitmap);
          constStream.listener?.loadTile(command.id, command.bitmap);
        } else if (command.type === 'lvc') {
          throw new Error('Unexpected vector tile');
        } else if (command.type === 'utc') {
          for (const id of command.ids) {
            tiles.delete(id);
          }
          constStream.listener?.unloadTiles(command.ids);
        } else {
          checkExhaustive(command, 'Unknown type of command');
        }
      };
    }

    stream.listener = listener;
    for (const [id, bitmap] of stream.tiles) {
      listener.loadTile(id, bitmap);
    }

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

  streamVectors(tileset: VectorTileset, listener: VectorListener): Disposable {
    let stream = this.vectorStreams.get(tileset);
    if (!stream) {
      const fetcher = new Worker('/static/tile_fetcher_worker.js');
      fetcher.postMessage({
        type: 'str',
        tileset,
      });

      const tiles = new HashMap<TileId, ArrayBuffer>(id => `${id.x},${id.y},${id.zoom}`);
      const constStream = {
        fetcher,
        listener,
        tiles,
      };
      stream = constStream;
      this.vectorStreams.set(tileset, stream);

      fetcher.onmessage = e => {
        const command = e.data as FetcherCommand;
        if (command.type === 'lbc') {
          throw new Error('Unexpected bitmap tile');
        } else if (command.type === 'lvc') {
          tiles.set(command.id, command.data);
          constStream.listener?.loadTile(command.id, command.data);
        } else if (command.type === 'utc') {
          for (const id of command.ids) {
            tiles.delete(id);
          }
          constStream.listener?.unloadTiles(command.ids);
        } else {
          checkExhaustive(command, 'Unknown type of command');
        }
      };
    }

    for (const [id, vector] of stream.tiles) {
      listener.loadTile(id, vector);
    }

    const disposable = new Disposable();
    const constStream = stream;
    disposable.registerDisposer(() => {
      constStream.listener = undefined;
    });
    return disposable;
  }

  updateViewport(center: Vec2, viewportSize: Vec2, zoom: number): void {
    for (const stream of this.bitmapStreams.values()) {
      stream.fetcher.postMessage({
        cameraPosition: center,
        cameraZoom: zoom + DPI_ZOOM,
        type: 'uvr',
        viewportSize,
      });
    }

    for (const stream of this.vectorStreams.values()) {
      stream.fetcher.postMessage({
        cameraPosition: center,
        cameraZoom: zoom + DPI_ZOOM,
        type: 'uvr',
        viewportSize,
      });
    }
  }
}

