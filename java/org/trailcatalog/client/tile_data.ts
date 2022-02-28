import { checkExhaustive } from './models/asserts';
import { HashMap } from './models/collections';
import { TileId, Vec2 } from './models/types';
import { FetcherCommand } from './workers/tile_fetcher';

import { Camera } from './camera';
import { Layer } from './layer';
import { RenderPlanner } from './render_planner';
import { Renderer } from './renderer';

export class TileData implements Layer {

  private readonly fetcher: Worker;
  private lastChange: number;
  private readonly pool: TexturePool;
  private readonly tiles: HashMap<TileId, WebGLTexture>;

  constructor(
      private readonly camera: Camera,
      private readonly renderer: Renderer) {
    this.fetcher = new Worker('static/tile_fetcher_worker.js');
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
    this.lastChange = Date.now();
    this.pool = new TexturePool(renderer);
    this.tiles = new HashMap(id => `${id.x},${id.y},${id.zoom}`);
  }

  hasDataNewerThan(time: number): boolean {
    return this.lastChange > time;
  }

  plan(viewportSize: Vec2, planner: RenderPlanner): void {
    for (const [id, texture] of this.tiles) {
      if (!texture) {
        continue;
      }

      const halfWorldSize = Math.pow(2, id.zoom - 1);
      const size = 1 / halfWorldSize;
      planner.addBillboard([
          (id.x + 0.5) / halfWorldSize,
          (id.y - 0.5) / halfWorldSize,
      ], [size, size], texture);
    }
  }

  viewportBoundsChanged(viewportSize: Vec2): void {
    this.fetcher.postMessage({
      cameraPosition: this.camera.centerPixel,
      cameraZoom: this.camera.zoom,
      viewportSize,
    });
  }

  private loadTile(id: TileId, bitmap: ImageBitmap): void {
    const texture = this.pool.acquire();
    this.renderer.uploadTexture(bitmap, texture);
    this.tiles.set(id, texture);
    this.lastChange = Date.now();
  }

  private unloadTiles(ids: TileId[]): void {
    for (const id of ids) {
      const texture = this.tiles.get(id);
      if (texture) {
        this.tiles.delete(id);
        this.pool.release(texture);
      }
    }
  }
}

class TexturePool {
  private readonly free: WebGLTexture[];

  constructor(private readonly renderer: Renderer) {
    this.free = [];
  }

  acquire(): WebGLTexture {
    return this.free.pop() ?? this.renderer.createTexture();
  }

  release(texture: WebGLTexture): void {
    this.free.push(texture);
  }
}

interface Tileset {
  urlFor(id: TileId): string;
}

class Landscape implements Tileset {
  urlFor(id: TileId): string {
    return `https://tile.thunderforest.com/landscape/${id.zoom}/${id.x}/${id.y}.png?` +
        `apikey=d72e980f5f1849fbb9fb3a113a119a6f`;
  }
}

