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
import { BASE_ZOOM, MAX_ZOOM, SLOPES_SIZE, TILE_URL } from '../workers/terrarium';
import { Command as FetcherCommand, Initialize as FetcherInitialize, LoadTileCommand, Request as FetcherRequest } from '../workers/xyz_data_fetcher';

const NO_OFFSET: Vec2 = [0, 0];
const OPAQUE = 0xFFFFFFFF as RgbaU32;

// Tiles below z12 are too coarse to faithfully compute angles on. Past z12 Mapterhorn only has
// tiles where a finer source covers the area, so each tile we show draws from a source tile that is
// either itself or its nearest ancestor that exists.
export class SlopeLayer extends Layer {

  private readonly buffer: WebGLBuffer;
  private readonly fetcher: PoolClient<FetcherInitialize, FetcherRequest, FetcherCommand>;
  private fetching: boolean;
  private readonly loader: PoolClient<undefined, LoaderRequest, LoaderResponse>;
  // Shown tiles still waiting on their source
  private readonly loading: HashSet<TileId>;
  // Source tiles Mapterhorn has no tile for
  private readonly missing: HashSet<TileId>;
  private readonly pool: TexturePool;
  // Source tiles the loader is working on
  private readonly requested: HashSet<TileId>;
  // Shown tiles by the source tile they draw from
  private readonly shown: HashMap<TileId, TileId>;
  // By source tile
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
            .connect({
              url: TILE_URL,
              extraZoom: 1,
              minZoom: BASE_ZOOM,
              maxZoom: MAX_ZOOM,
              missingAsEmpty: true,
            });
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
    this.loading = createTileHashSet();
    this.missing = createTileHashSet();
    this.pool = new TexturePool(this.renderer);
    this.registerDisposable(this.pool);
    this.requested = createTileHashSet();
    this.shown = new HashMap(id => `${id.zoom},${id.x},${id.y}`);
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
          new ArrayBuffer(Math.max(BillboardProgram.bytesNeeded() * this.shown.size, 65536));
      const drawables = [];
      let offset = 0;
      // Draw lowest detail to highest because tiles share a z and the depth test passes equal
      const sorted = [...this.shown].sort((a, b) => a[0].zoom - b[0].zoom);
      for (const [id, source] of sorted) {
        const texture = this.tiles.get(source);
        if (!texture) {
          continue;
        }

        const halfWorldSize = Math.pow(2, id.zoom - 1);
        const size = 1 / halfWorldSize;
        const centerX = (id.x + 0.5 - halfWorldSize) / halfWorldSize;
        const centerY = (halfWorldSize - (id.y + 0.5)) / halfWorldSize;
        // A tile drawing from an ancestor shows the square of it that the tile covers.
        const across = Math.pow(2, id.zoom - source.zoom);
        const column = id.x - source.x * across;
        const row = id.y - source.y * across;
        const {byteSize, drawable} =
            this.renderer.slopeProgram.plan(
                [centerX, centerY],
                NO_OFFSET,
                [size, size],
                /* angle= */ 0,
                OPAQUE,
                this.z,
                /* atlasIndex= */ row * across + column,
                /* atlasSize= */ [across, across],
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
    const {id, data} = command;
    if (data.byteLength > 0) {
      // The tile may already be loaded or loading as the source of a finer one.
      this.shown.set(id, id);
      if (this.tiles.has(id)) {
        this.finish(id);
        this.redraw();
      } else {
        this.loading.add(id);
        if (!this.requested.has(id)) {
          this.requested.add(id);
          // Not a task, because a task holds the worker until it answers and a tile waits on the
          // neighbors that later messages bring.
          this.loader.broadcast({kind: 'lr', id, data}, [data]);
        }
      }
    } else if (id.zoom > BASE_ZOOM) {
      this.drawFrom(id, parentOf(id));
    } else {
      this.fetcher.broadcast({kind: 'tlr', id});
    }
  }

  // Shows the tile from source, or from source's nearest ancestor that exists.
  private drawFrom(id: TileId, source: TileId): void {
    while (this.missing.has(source) && source.zoom > BASE_ZOOM) {
      source = parentOf(source);
    }
    if (this.missing.has(source)) {
      this.finish(id);
      return;
    }

    this.shown.set(id, source);
    if (this.tiles.has(source)) {
      this.finish(id);
      this.redraw();
      return;
    }

    this.loading.add(id);
    if (!this.requested.has(source)) {
      this.requested.add(source);
      this.loader.broadcast({kind: 'lr', id: source, data: undefined});
    }
  }

  private loadSlopes(response: LoadResponse): void {
    const source = response.id;
    this.requested.delete(source);

    const waiting =
        [...this.shown].filter(([id, s]) => sameTile(s, source) && this.loading.has(id));
    if (response.missing) {
      this.missing.add(source);
      for (const [id] of waiting) {
        this.loading.delete(id);
        if (source.zoom > BASE_ZOOM) {
          this.drawFrom(id, parentOf(source));
        } else {
          this.shown.delete(id);
          this.finish(id);
        }
      }
      return;
    }

    // Every tile that needed the source may have been unloaded while the loader worked on it.
    if (response.slopes && waiting.length > 0) {
      const texture = this.pool.acquire();
      this.renderer.uploadRedTexture(response.slopes, [SLOPES_SIZE, SLOPES_SIZE], texture);
      this.tiles.set(source, texture);
      this.redraw();
    }
    for (const [id] of waiting) {
      this.finish(id);
    }
  }

  private finish(id: TileId): void {
    this.loading.delete(id);
    this.fetcher.broadcast({kind: 'tlr', id});
  }

  private unloadTiles(ids: TileId[]): void {
    for (const id of ids) {
      this.loading.delete(id);
      this.shown.delete(id);
    }

    const used = createTileHashSet();
    for (const source of this.shown.values()) {
      used.add(source);
    }
    for (const [source, texture] of [...this.tiles]) {
      if (!used.has(source)) {
        this.tiles.delete(source);
        this.pool.release(texture);
      }
    }

    this.redraw();
  }
}

function parentOf(id: TileId): TileId {
  return {x: Math.floor(id.x / 2), y: Math.floor(id.y / 2), zoom: id.zoom - 1};
}

function sameTile(a: TileId, b: TileId): boolean {
  return a.x === b.x && a.y === b.y && a.zoom === b.zoom;
}

function createTileHashSet(): HashSet<TileId> {
  return new HashSet(id => `${id.zoom},${id.x},${id.y}`);
}
