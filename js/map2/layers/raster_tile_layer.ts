import { S2LatLngRect } from 'java/org/trailcatalog/s2';
import { checkExhaustive } from 'js/common/asserts';
import { HashMap, HashSet } from 'js/common/collections';
import { Debouncer } from 'js/common/debouncer';
import { WorkerPool } from 'js/common/worker_pool';

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
  private readonly fetcher: Worker;
  private readonly loader: WorkerPool<LoaderRequest, LoaderResponse>;
  private readonly pool: TexturePool;
  private readonly tiles: HashMap<TileId, WebGLTexture|undefined>;
  private readonly unloader: Debouncer;
  private readonly unloading: HashSet<TileId>;
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
    this.fetcher = new Worker('/static/xyz_data_fetcher_worker.js');
    this.loader = new WorkerPool('/static/raster_loader_worker.js', 1);
    this.pool = new TexturePool(this.renderer);
    this.registerDisposable(this.pool);
    this.tiles = new HashMap(id => `${id.zoom},${id.x},${id.y}`);
    // Give ourselves at least 50ms to decode and load a tile into the GPU.
    this.unloader = new Debouncer(/* ms= */ 50, () => {
      this.unloadTiles();
    });
    this.unloading = new HashSet(id => `${id.zoom},${id.x},${id.y}`);
    this.generation = 0;
    this.plan = {
      generation: -1,
      drawables: [],
    };

    this.fetcher.onmessage = e => {
      const command = e.data as FetcherCommand;
      if (command.kind === 'ltc') {
        this.loadTile(command);
      } else if (command.kind === 'utc') {
        command.ids.forEach(id => { this.unloading.add(id); });
        this.unloader.trigger();
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

    this.postFetcherRequest({
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

  hasNewData(): boolean {
    return this.generation !== this.plan.generation;
  }

  render(planner: Planner): void {
    if (this.hasNewData()) {
      const buffer = new ArrayBuffer(4 * 256 * 256);
      const drawables = [];
      let offset = 0;

      // Draw highest detail to lowest, we use the stencil buffer to avoid overdraw.
      const sorted = [...this.tiles].sort((a, b) => b[0].zoom - a[0].zoom);
      for (const [id, texture] of sorted) {
        if (!texture) {
          continue;
        }

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

  viewportChanged(bounds: S2LatLngRect, zoom: number): void {
    const lat = bounds.lat();
    const lng = bounds.lng();
    this.postFetcherRequest({
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
    this.tiles.set(id, undefined);
    this.unloading.delete(id);
    this.loader.post({
      kind: 'lr',
      id,
      data: command.data,
    }, [command.data]);
  }

  private loadBitmap(response: LoadResponse): void {
    // Has this already been unloaded?
    if (!this.tiles.has(response.id)) {
      return;
    }

    const texture = this.pool.acquire();
    this.renderer.uploadTexture(response.bitmap, texture);
    this.tiles.set(response.id, texture);
    this.generation += 1;
  }

  private unloadTiles(): void {
    for (const id of this.unloading) {
      const texture = this.tiles.get(id);
      if (texture) {
        this.tiles.delete(id);
        this.pool.release(texture);
      }
    }
    this.unloading.clear();
    // no need to bump the generation
  }

  private postFetcherRequest(request: FetcherRequest, transfer?: Transferable[]) {
    this.fetcher.postMessage(request, transfer ?? []);
  }
}

