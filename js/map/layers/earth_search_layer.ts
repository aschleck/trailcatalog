import { S2LatLngRect } from 'java/org/trailcatalog/s2';
import { checkExhaustive } from 'external/dev_april_corgi+/js/common/asserts';
import { HashMap } from 'external/dev_april_corgi+/js/common/collections';
import { QueuedWorkerPool, Task } from 'external/dev_april_corgi+/js/common/queued_worker_pool';

import { RgbaU32, TileId, Vec2 } from '../common/types';
import { Layer } from '../layer';
import { Planner } from '../rendering/planner';
import { Drawable } from '../rendering/program';
import { Renderer } from '../rendering/renderer';
import { TexturePool } from '../rendering/texture_pool';
import { Command as LoaderCommand, LoadTileCommand, Request as LoaderRequest } from '../workers/earth_search_loader';

const NO_OFFSET: Vec2 = [0, 0];

export class EarthSearchLayer extends Layer {

  private readonly buffer: WebGLBuffer;
  private readonly loader: QueuedWorkerPool<LoaderRequest, LoaderCommand>;
  private readonly pool: TexturePool;
  private readonly tiles: HashMap<TileId, WebGLTexture>;
  private fetching: boolean;
  private generation: number;
  private plan: {generation: number; drawables: Drawable[]};

  constructor(
      collection: string,
      daysToFetch: number,
      query: object,
      private readonly z: number,
      private readonly renderer: Renderer,
  ) {
    super(
      [{
        long: 'Copernicus Sentinel data 2021',
        short: 'Copernicus 2021',
      }],
    );

    this.buffer = this.renderer.createDataBuffer(0);
    this.registerDisposer(() => { this.renderer.deleteBuffer(this.buffer); });
    this.loader = new QueuedWorkerPool('/static/earth_search_loader_worker.js', 1);
    this.fetching = false;
    this.pool = new TexturePool(this.renderer);
    this.registerDisposable(this.pool);
    this.tiles = new HashMap(id => `${id.zoom},${id.x},${id.y}`);
    this.generation = 0;
    this.plan = {
      generation: -1,
      drawables: [],
    };

    this.loader.onresponse = command => {
      if (command.kind === 'ltc') {
        this.loadTile(command);
      } else if (command.kind === 'utc') {
        this.unloadTiles(command.ids);
      } else if (command.kind === 'usc') {
        this.fetching = command.fetching;
      } else {
        checkExhaustive(command);
      }
    };

    this.loader.broadcast({
      kind: 'ir',
      collection,
      daysToFetch,
      query,
    });
  }

  override hasNewData(): boolean {
    return this.generation !== this.plan.generation;
  }

  override loadingData(): boolean {
    return this.fetching;
  }

  override render(planner: Planner): void {
    if (this.hasNewData()) {
      const buffer = new ArrayBuffer(4 * 256 * 256);
      const drawables = [];
      let offset = 0;

      // Draw highest detail to lowest, we use the stencil buffer to avoid overdraw.
      const sorted = [...this.tiles].sort((a, b) => b[0].zoom - a[0].zoom);
      for (const [id, texture] of sorted) {
        const halfWorldSize = Math.pow(2, id.zoom - 1);
        const size = 1 / halfWorldSize;
        const {byteSize, drawable} =
            this.renderer.billboardProgram.plan(
                [
                  (id.x + 0.5 - halfWorldSize) / halfWorldSize,
                  (halfWorldSize - (id.y + 0.5)) / halfWorldSize,
                ],
                NO_OFFSET,
                [size, size],
                /* angle= */ 0,
                0xFFFFFFFF as RgbaU32,
                this.z,
                /* atlasIndex= */ 0,
                /* atlasSize= */ [1, 1],
                buffer,
                offset,
                this.buffer,
                texture);
        drawables.push(drawable);
        offset += byteSize;
      }

      this.renderer.uploadData(buffer, offset, this.buffer);
      this.plan = {
        generation: this.generation,
        drawables,
      };
    }

    planner.add(this.plan.drawables);
  }

  override viewportChanged(bounds: S2LatLngRect, zoom: number): void {
    const lat = bounds.lat();
    const lng = bounds.lng();
    this.loader.broadcast({
      kind: 'uvr',
      viewport: {
        lat: [lat.lo(), lat.hi()],
        lng: [lng.lo(), lng.hi()],
        zoom,
      },
    });
  }

  private loadTile(command: LoadTileCommand): void {
    const texture = this.pool.acquire();
    this.renderer.uploadTexture(command.bitmap, texture);

    this.tiles.set(command.id, texture);
    this.generation += 1;
  }

  private unloadTiles(ids: TileId[]): void {
    for (const id of ids) {
      const texture = this.tiles.get(id);
      if (texture) {
        this.tiles.delete(id);
        this.pool.release(texture);
      }
    }

    this.generation += 1;
  }
}
