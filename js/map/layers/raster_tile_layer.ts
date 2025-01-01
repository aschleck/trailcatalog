import { S2LatLngRect } from 'java/org/trailcatalog/s2';
import { checkExhaustive } from 'external/dev_april_corgi~/js/common/asserts';
import { HashMap } from 'external/dev_april_corgi~/js/common/collections';
import { QueuedWorkerPool, Task } from 'external/dev_april_corgi~/js/common/queued_worker_pool';
import { WorkerPool } from 'external/dev_april_corgi~/js/common/worker_pool';

import { Copyright, RgbaU32, TileId, Vec2 } from '../common/types';
import { Layer } from '../layer';
import { Planner } from '../rendering/planner';
import { Drawable } from '../rendering/program';
import { Renderer } from '../rendering/renderer';
import { TexturePool } from '../rendering/texture_pool';
import { LoadResponse, Request as LoaderRequest, Response as LoaderResponse } from '../workers/raster_loader';
import { Command as FetcherCommand, LoadTileCommand, Request as FetcherRequest, UnloadTilesCommand } from '../workers/xyz_data_fetcher';

const NO_OFFSET: Vec2 = [0, 0];

export class RasterTileLayer extends Layer {

  private readonly buffer: WebGLBuffer;
  private readonly fetcher: WorkerPool<FetcherRequest, FetcherCommand>;
  private fetching: boolean;
  private readonly loader: QueuedWorkerPool<LoaderRequest, LoaderResponse>;
  private readonly loading: HashMap<TileId, Task<LoaderResponse>>;
  private readonly pool: TexturePool;
  private readonly tiles: HashMap<TileId, WebGLTexture>;
  private generation: number;
  private plan: {generation: number; drawables: Drawable[]};

  constructor(
      copyrights: Copyright[],
      url: string,
      private readonly tint: RgbaU32,
      private readonly z: number,
      extraZoom: number,
      minZoom: number,
      maxZoom: number,
      private readonly renderer: Renderer,
  ) {
    super(copyrights);
    this.buffer = this.renderer.createDataBuffer(0);
    this.registerDisposer(() => { this.renderer.deleteBuffer(this.buffer); });
    this.fetcher = new WorkerPool('/static/xyz_data_fetcher_worker.js', 1);
    this.fetching = false;
    this.loader = new QueuedWorkerPool('/static/raster_loader_worker.js', 6);
    this.loading = new HashMap(id => `${id.zoom},${id.x},${id.y}`);
    this.pool = new TexturePool(this.renderer);
    this.registerDisposable(this.pool);
    this.tiles = new HashMap(id => `${id.zoom},${id.x},${id.y}`);
    this.generation = 0;
    this.plan = {
      generation: -1,
      drawables: [],
    };

    this.fetcher.onresponse = command => {
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

    this.loader.onresponse = response => {
      if (response.kind === 'lr') {
        this.loadBitmap(response);
      } else {
        checkExhaustive(response.kind);
      }
    };

    this.fetcher.broadcast({
      kind: 'ir',
      url,
      extraZoom,
      minZoom,
      maxZoom,
    });
    this.loader.broadcast({
      kind: 'ir',
    });
  }

  override hasNewData(): boolean {
    return this.generation !== this.plan.generation;
  }

  override loadingData(): boolean {
    return this.fetching || this.loading.size > 0;
  }

  override render(planner: Planner): void {
    if (this.hasNewData()) {
      const buffer = new ArrayBuffer(16 * 256 * 256);
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
                this.tint,
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
    this.fetcher.post({
      kind: 'uvr',
      viewport: {
        lat: [lat.lo(), lat.hi()],
        lng: [lng.lo(), lng.hi()],
        zoom,
      },
    });
  }

  private loadTile(command: LoadTileCommand): void {
    if (command.data.byteLength === 0) {
      return;
    }

    const id = command.id;
    const task = this.loader.post({
      kind: 'lr',
      id,
      data: command.data,
    }, [command.data]);
    this.loading.set(id, task);
  }

  private loadBitmap(response: LoadResponse): void {
    const texture = this.pool.acquire();
    this.renderer.uploadTexture(response.bitmap, texture);

    this.loading.delete(response.id);
    this.tiles.set(response.id, texture);
    this.generation += 1;

    this.fetcher.broadcast({
      kind: 'tlr',
      id: response.id,
    });
  }

  private unloadTiles(ids: TileId[]): void {
    for (const id of ids) {
      const task = this.loading.get(id);
      if (task) {
        this.loading.delete(id);
        task.cancel();
      }

      const texture = this.tiles.get(id);
      if (texture) {
        this.tiles.delete(id);
        this.pool.release(texture);
      }
    }

    this.generation += 1;
  }
}

