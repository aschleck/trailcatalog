import { HashMap } from 'js/common/collections';

import { BitmapTileset, TileId, Vec2 } from '../common/types';
import { Layer } from '../layer';
import { Camera } from '../models/camera';
import { RenderPlanner } from '../rendering/render_planner';
import { Renderer } from '../rendering/renderer';
import { TexturePool } from '../rendering/texture_pool';

import { TileDataService } from './tile_data_service';

const NO_OFFSET: Vec2 = [0, 0];

export class TileData extends Layer {

  private lastChange: number;
  private readonly pool: TexturePool;
  private readonly tiles: HashMap<TileId, WebGLTexture>;

  constructor(
      private readonly camera: Camera,
      private readonly dataService: TileDataService,
      private readonly renderer: Renderer,
      tileset: BitmapTileset) {
    super();
    this.lastChange = Date.now();
    this.pool = new TexturePool(renderer);
    this.tiles = new HashMap(id => `${id.x},${id.y},${id.zoom}`);

    this.registerDisposable(this.dataService.streamBitmaps(tileset, this));
  }

  hasDataNewerThan(time: number): boolean {
    return this.lastChange > time;
  }

  plan(viewportSize: Vec2, zoom: number, planner: RenderPlanner): void {
    const sorted = [...this.tiles].sort((a, b) => a[0].zoom - b[0].zoom);
    for (const [id, texture] of sorted) {
      if (!texture) {
        continue;
      }

      const halfWorldSize = Math.pow(2, id.zoom - 1);
      const size = 1 / halfWorldSize;
      planner.addBillboard([
          (id.x + 0.5) / halfWorldSize,
          (id.y - 0.5) / halfWorldSize,
      ], NO_OFFSET, [size, size], texture, /* z= */ -1);
    }
  }

  viewportBoundsChanged(viewportSize: Vec2, zoom: number): void {
    this.dataService.updateViewport(this.camera.centerPixel, viewportSize, zoom);
  }

  loadTile(id: TileId, bitmap: ImageBitmap): void {
    const texture = this.pool.acquire();
    this.renderer.uploadTexture(bitmap, texture);
    this.tiles.set(id, texture);
    this.lastChange = Date.now();
  }

  unloadTiles(ids: TileId[]): void {
    for (const id of ids) {
      const texture = this.tiles.get(id);
      if (texture) {
        this.tiles.delete(id);
        this.pool.release(texture);
      }
    }
    this.lastChange = Date.now();
  }
}

