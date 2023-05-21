import { checkExhaustive } from 'js/common/asserts';
import { HashMap } from 'js/common/collections';

import { BitmapTileset, TileId, Vec2 } from '../common/types';
import { Layer } from '../layer';
import { Camera } from '../models/camera';
import { RenderBaker } from '../rendering/render_baker';
import { Renderer } from '../rendering/renderer';
import { TexturePool } from '../rendering/texture_pool';

import { TileDataService } from './tile_data_service';

const NO_OFFSET: Vec2 = [0, 0];

export enum Style {
  Hypsometry,
  Rgb,
}

export class TileData extends Layer {

  private lastChange: number;
  private readonly pool: TexturePool;
  private readonly tiles: HashMap<TileId, WebGLTexture>;

  constructor(
      private readonly camera: Camera,
      private readonly dataService: TileDataService,
      private readonly renderer: Renderer,
      private readonly style: Style,
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

  plan(viewportSize: Vec2, zoom: number, baker: RenderBaker): void {
    const sorted = [...this.tiles].sort((a, b) => a[0].zoom - b[0].zoom);
    for (const [id, texture] of sorted) {
      if (!texture) {
        continue;
      }

      const halfWorldSize = Math.pow(2, id.zoom - 1);
      const size = 1 / halfWorldSize;
      if (this.style === Style.Hypsometry) {
        baker.addHypsometry([
            (id.x + 0.5) / halfWorldSize,
            (id.y - 0.5) / halfWorldSize,
        ], [size, size], texture, /* z= */ -1);
      } else if (this.style === Style.Rgb) {
        baker.addBillboard([
            (id.x + 0.5) / halfWorldSize,
            (id.y - 0.5) / halfWorldSize,
        ], NO_OFFSET, [size, size], texture, /* z= */ -1);
      } else {
        checkExhaustive(this.style);
      }
    }
  }

  viewportBoundsChanged(viewportSize: Vec2, zoom: number): void {
    this.dataService.updateViewport(this.camera.centerPixel, viewportSize, zoom);
  }

  tilesChanged(load: Array<[TileId, ImageBitmap]>, unload: TileId[]): void {
    for (const [id, bitmap] of load) {
      const texture = this.pool.acquire();
      this.renderer.uploadDataTexture(bitmap, texture);
      this.tiles.set(id, texture);
    }

    for (const id of unload) {
      const texture = this.tiles.get(id);
      if (texture) {
        this.tiles.delete(id);
        this.pool.release(texture);
      }
    }

    this.lastChange = Date.now();
  }
}

