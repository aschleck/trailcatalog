import { checkExhaustive } from 'js/common/asserts';
import { EmptyDeps } from 'js/corgi/deps';
import { Service, ServiceResponse } from 'js/corgi/service';

import { HashMap } from '../common/collections';
import { TileId, Vec2 } from '../common/types';
import { FetcherCommand } from '../workers/tile_fetcher';

interface Listener {
  loadTile(id: TileId, bitmap: ImageBitmap): void;
  unloadTiles(ids: TileId[]): void;
}

export class TileDataService extends Service<EmptyDeps> {

  private readonly fetcher: Worker;
  private readonly tiles: HashMap<TileId, ImageBitmap>;
  private listener: Listener|undefined;

  constructor(response: ServiceResponse<EmptyDeps>) {
    super(response);
    this.fetcher = new Worker('/static/tile_fetcher_worker.js');
    this.tiles = new HashMap(id => `${id.x},${id.y},${id.zoom}`);

    this.fetcher.onmessage = e => {
      const command = e.data as FetcherCommand;
      if (command.type === 'ltc') {
        this.loadTile(command.id, command.bitmap);
      } else if (command.type === 'utc') {
        this.unloadTiles(command.ids);
      } else {
        checkExhaustive(command, 'Unknown type of command');
      }
    };
  }

  updateViewport(center: Vec2, viewportSize: Vec2, zoom: number): void {
    this.fetcher.postMessage({
      cameraPosition: center,
      cameraZoom: zoom,
      viewportSize,
    });
  }

  setListener(listener: Listener): void {
    this.listener = listener;

    for (const [id, bitmap] of this.tiles) {
      this.listener.loadTile(id, bitmap);
    }
  }

  clearListener(): void {
    this.listener = undefined;
  }

  private loadTile(id: TileId, bitmap: ImageBitmap): void {
    this.tiles.set(id, bitmap);
    this.listener?.loadTile(id, bitmap);
  }

  private unloadTiles(ids: TileId[]): void {
    for (const id of ids) {
      this.tiles.delete(id);
    }
    this.listener?.unloadTiles(ids);
  }
}

