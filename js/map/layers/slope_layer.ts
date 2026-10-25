import { S2LatLngRect } from 'java/org/trailcatalog/s2';
import { checkExhaustive } from 'external/dev_april_corgi+/js/common/asserts';
import { HashMap, HashSet } from 'external/dev_april_corgi+/js/common/collections';

import { SphericalCone } from '../camera';
import { Copyright, RgbaU32, TileId, Vec2 } from '../common/types';
import { Layer } from '../layer';
import { BillboardProgram } from '../rendering/billboard_program';
import { Planner } from '../rendering/planner';
import { Drawable } from '../rendering/program';
import { Renderer } from '../rendering/renderer';
import { TexturePool } from '../rendering/texture_pool';
import { PoolClient, sharedPool } from '../workers/client_pool';
import { Request as LoaderRequest, Response as LoaderResponse, LoadResponse } from '../workers/slope_loader';
import { BASE_ZOOM, TILE_SIZE, TILE_URL } from '../workers/terrarium';
import { Command as FetcherCommand, Initialize as FetcherInitialize, LoadTileCommand, Request as FetcherRequest } from '../workers/xyz_data_fetcher';

const NO_OFFSET: Vec2 = [0, 0];
// Keep in sync with slope_loader.ts#SLOPES_SIZE
const SLOPES_SIZE = TILE_SIZE + 2;
const OPAQUE = 0xFFFFFFFF as RgbaU32;

// Tiles below z12 are too coarse to faithfully compute angles on.
export class SlopeLayer extends Layer {

  private readonly buffer: WebGLBuffer;
  private readonly fetcher: PoolClient<FetcherInitialize, FetcherRequest, FetcherCommand>;
  private fetching: boolean;
  private readonly loader: PoolClient<undefined, LoaderRequest, LoaderResponse>;
  private readonly loading: HashSet<TileId>;
  private readonly pool: TexturePool;
  private readonly tiles: HashMap<TileId, WebGLTexture>;
  private plan: {generation: number; drawables: Drawable[]};

  constructor(
      copyrights: Copyright[],
      private readonly z: number,
      private readonly renderer: Renderer,
  ) {
    super(copyrights);
    this.buffer = this.renderer.createDataBuffer(0);
    this.registerDisposer(() => { this.renderer.deleteBuffer(this.buffer); });
    this.fetcher =
        sharedPool<FetcherInitialize, FetcherRequest, FetcherCommand>(
            new URL('xyz_data_fetcher_worker.js', import.meta.url).href, /* count= */ 1)
            .connect({url: TILE_URL, extraZoom: 1, minZoom: BASE_ZOOM, maxZoom: BASE_ZOOM});
    this.fetching = false;
    // One worker, so that every tile shares its cache of the neighbors' edges
    this.loader =
        sharedPool<undefined, LoaderRequest, LoaderResponse>(
            new URL('slope_loader_worker.js', import.meta.url).href, /* count= */ 1)
            .connect(undefined);
    this.registerDisposer(() => {
      this.fetcher.dispose();
      this.loader.dispose();
    });
    this.loading = new HashSet(id => `${id.zoom},${id.x},${id.y}`);
    this.pool = new TexturePool(this.renderer);
    this.registerDisposable(this.pool);
    this.tiles = new HashMap(id => `${id.zoom},${id.x},${id.y}`);
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
        this.redraw();
      } else {
        checkExhaustive(command);
      }
    };

    this.loader.onresponse = response => {
      if (response.kind === 'lr') {
        this.loadSlopes(response);
      } else {
        checkExhaustive(response.kind);
      }
    };
  }

  override loadingData(): boolean {
    return this.fetching || this.loading.size > 0;
  }

  override render(planner: Planner): void {
    if (this.generation !== this.plan.generation) {
      const buffer =
          new ArrayBuffer(Math.max(BillboardProgram.bytesNeeded() * this.tiles.size, 65536));
      const drawables = [];
      let offset = 0;
      for (const [id, texture] of this.tiles) {
        const halfWorldSize = Math.pow(2, id.zoom - 1);
        const size = 1 / halfWorldSize;
        const centerX = (id.x + 0.5 - halfWorldSize) / halfWorldSize;
        const centerY = (halfWorldSize - (id.y + 0.5)) / halfWorldSize;
        const {byteSize, drawable} =
            this.renderer.slopeProgram.plan(
                [centerX, centerY],
                NO_OFFSET,
                [size, size],
                /* angle= */ 0,
                OPAQUE,
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

  override viewportChanged(
      bounds: S2LatLngRect, zoom: number, fetchZoom: number, cone?: SphericalCone): void {
    this.loader.start();
    const lat = bounds.lat();
    const lng = bounds.lng();
    this.fetcher.broadcast({
      kind: 'uvr',
      viewport: {
        lat: [lat.lo(), lat.hi()],
        lng: [lng.lo(), lng.hi()],
        zoom: fetchZoom,
        cone,
      },
    });
  }

  private loadTile(command: LoadTileCommand): void {
    if (command.data.byteLength === 0) {
      this.fetcher.broadcast({
        kind: 'tlr',
        id: command.id,
      });
      return;
    }

    this.loading.add(command.id);
    // Not a task, because a task holds the worker until it answers and a tile waits on the
    // neighbors that later messages bring.
    this.loader.broadcast({
      kind: 'lr',
      id: command.id,
      data: command.data,
    }, [command.data]);
  }

  private loadSlopes(response: LoadResponse): void {
    // The fetcher unloaded the tile while the loader waited on its neighbors.
    if (!this.loading.has(response.id)) {
      return;
    }
    this.loading.delete(response.id);

    if (response.slopes) {
      const texture = this.pool.acquire();
      this.renderer.uploadRedTexture(response.slopes, [SLOPES_SIZE, SLOPES_SIZE], texture);
      this.tiles.set(response.id, texture);
      this.redraw();
    }

    this.fetcher.broadcast({
      kind: 'tlr',
      id: response.id,
    });
  }

  private unloadTiles(ids: TileId[]): void {
    for (const id of ids) {
      this.loading.delete(id);

      const texture = this.tiles.get(id);
      if (texture) {
        this.tiles.delete(id);
        this.pool.release(texture);
      }
    }

    this.redraw();
  }
}
