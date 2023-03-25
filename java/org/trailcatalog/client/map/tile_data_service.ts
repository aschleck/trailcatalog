import { checkExhaustive } from 'js/common/asserts';
import { Disposable } from 'js/common/disposable';
import { EmptyDeps } from 'js/corgi/deps';
import { Service, ServiceResponse } from 'js/corgi/service';

import { HashMap } from '../common/collections';
import { BitmapTileset, TileId, Tileset, Vec2 } from '../common/types';
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

export class TileDataService extends Service<EmptyDeps> {

  private readonly bitmapStreams: Map<Tileset, BitmapStream>;

  constructor(response: ServiceResponse<EmptyDeps>) {
    super(response);
    this.bitmapStreams = new Map();
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

    for (const [id, bitmap] of stream.tiles) {
      listener.loadTile(id, bitmap);
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
        cameraZoom: zoom,
        type: 'uvr',
        viewportSize,
      });
    }
  }
}

