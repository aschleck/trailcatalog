import { S2LatLngRect } from 'java/org/trailcatalog/s2';
import { checkExhaustive } from 'js/common/asserts';
import { HashMap } from 'js/common/collections';
import { RgbaU32, TileId, Vec2 } from 'js/map2/common/types';
import { Layer } from 'js/map2/layer';
import { Planner } from 'js/map2/rendering/planner';
import { Drawable } from 'js/map2/rendering/program';
import { Renderer } from 'js/map2/rendering/renderer';
import { TexturePool } from 'js/map2/rendering/texture_pool';
import { LoadResponse, Request as LoaderRequest, Response as LoaderResponse } from 'js/map2/workers/raster_loader';
import { Command as FetcherCommand, LoadTileCommand, Request as FetcherRequest, UnloadTilesCommand } from 'js/map2/workers/xyz_data_fetcher';

const NO_OFFSET: Vec2 = [0, 0];

export class RasterTileLayer extends Layer {

  private readonly buffer: WebGLBuffer;
  private readonly fetcher: Worker;
  private readonly loader: Worker;
  private readonly pool: TexturePool;
  private readonly tiles: HashMap<TileId, WebGLTexture|undefined>;
  private generation: number;
  private plan: {generation: number; drawables: Drawable[]};

  constructor(
      url: string,
      extraZoom: number,
      minZoom: number,
      maxZoom: number,
      private readonly renderer: Renderer,
  ) {
    super();
    this.buffer = this.renderer.createDataBuffer(0);
    this.registerDisposer(() => { this.renderer.deleteBuffer(this.buffer); });
    this.fetcher = new Worker('/static/xyz_data_fetcher_worker.js');
    this.loader = new Worker('/static/raster_loader_worker.js');
    this.pool = new TexturePool(this.renderer);
    this.registerDisposable(this.pool);
    this.tiles = new HashMap(id => `${id.zoom},${id.x},${id.y}`);
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
        this.unloadTiles(command);
      } else {
        checkExhaustive(command);
      }
    };

    this.loader.onmessage = e => {
      const response = e.data as LoaderResponse;
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
    this.postLoaderRequest({
      kind: 'ir',
    });
  }

  hasNewData(): boolean {
    return this.generation !== this.plan.generation;
  }

  render(planner: Planner): void {
    if (this.hasNewData()) {
      const buffer = new ArrayBuffer(65536);
      const drawables = [];
      let offset = 0;

      const sorted = [...this.tiles].sort((a, b) => a[0].zoom - b[0].zoom);
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
                /* tint= */ 0xFFFFFFFF as RgbaU32,
                /* z= */ 0,
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

    this.tiles.set(command.id, undefined);
    this.postLoaderRequest({
      kind: 'lr',
      id: command.id,
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

  private unloadTiles(command: UnloadTilesCommand): void {
    for (const id of command.ids) {
      const texture = this.tiles.get(id);
      if (texture) {
        this.tiles.delete(id);
        this.pool.release(texture);
      }
    }
    this.generation += 1;
  }

  private postFetcherRequest(request: FetcherRequest, transfer?: Transferable[]) {
    this.fetcher.postMessage(request, transfer ?? []);
  }

  private postLoaderRequest(request: LoaderRequest, transfer?: Transferable[]) {
    this.loader.postMessage(request, transfer ?? []);
  }
}

