import { S2LatLng, S2LatLngRect } from 'java/org/trailcatalog/s2';
import { checkExhaustive } from 'external/dev_april_corgi+/js/common/asserts';
import { HashMap } from 'external/dev_april_corgi+/js/common/collections';
import { QueuedWorkerPool, Task } from 'external/dev_april_corgi+/js/common/queued_worker_pool';

import { projectS2LatLng } from '../camera';
import { Copyright, RgbaU32, TileId, Vec2 } from '../common/types';
import { Layer } from '../layer';
import { BillboardProgram } from '../rendering/billboard_program';
import { Planner } from '../rendering/planner';
import { Drawable } from '../rendering/program';
import { Renderer } from '../rendering/renderer';
import { TexturePool } from '../rendering/texture_pool';
import { Bands, Catalog, Command as LoaderCommand, LoadTileCommand, Request as LoaderRequest, Search } from '../workers/stac_loader';

const NO_OFFSET: Vec2 = [0, 0];
// A viewport holds well under 64 billboards, so the buffer never grows in practice.
const TILE_BUFFER_BYTES = 65536;

export class StacLayer extends Layer {

  private readonly buffer: WebGLBuffer;
  private readonly loader: QueuedWorkerPool<LoaderRequest, LoaderCommand>;
  private readonly pool: TexturePool;
  private readonly tiles: HashMap<TileId, WebGLTexture>;
  // For bands that send their values
  private readonly values: HashMap<TileId, Uint8Array>;
  private fetching: boolean;
  private plan: {generation: number; drawables: Drawable[]};
  private search: Search;

  constructor(
      catalog: Catalog,
      search: Search,
      bands: Bands,
      // The year the imagery starts, for crediting a search with no start
      private readonly firstYear: number,
      // Credits the imagery for a range of years, like "2015-2026"
      private readonly credit: (years: string) => Copyright[],
      private readonly z: number,
      private readonly renderer: Renderer,
      private readonly tint: RgbaU32 = 0xFFFFFFFF as RgbaU32,
  ) {
    super();

    this.buffer = this.renderer.createDataBuffer(TILE_BUFFER_BYTES);
    this.registerDisposer(() => { this.renderer.deleteBuffer(this.buffer); });
    this.loader =
        new QueuedWorkerPool(new URL('stac_loader_worker.js', import.meta.url).href, 1);
    this.fetching = false;
    this.pool = new TexturePool(this.renderer);
    this.registerDisposable(this.pool);
    this.tiles = new HashMap(id => `${id.zoom},${id.x},${id.y}`);
    this.values = new HashMap(id => `${id.zoom},${id.x},${id.y}`);
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
        this.redraw();
      } else {
        checkExhaustive(command);
      }
    };

    this.search = search;
    this.loader.broadcast({
      kind: 'ir',
      catalog,
      search,
      bands,
    });
  }

  /** Replaces the imagery on screen with what the search finds, drawn with the bands. */
  setSearch(search: Search, bands: Bands): void {
    this.search = search;
    this.loader.broadcast({
      kind: 'usr',
      search,
      bands,
    });
  }

  /**
   * Returns the byte of the most detailed loaded pixel under the point, for bands that send their
   * values, or 0 where no source has data.
   */
  valueAt(point: S2LatLng): number|undefined {
    const [x, y] = projectS2LatLng(point);
    let best: {zoom: number; value: number}|undefined = undefined;
    for (const [id, values] of this.values) {
      if (best && best.zoom >= id.zoom) {
        continue;
      }

      const size = Math.sqrt(values.length);
      const tiles = 2 ** id.zoom;
      const px = Math.floor(((x + 1) / 2 * tiles - id.x) * size);
      const py = Math.floor(((1 - y) / 2 * tiles - id.y) * size);
      if (px < 0 || py < 0 || px >= size || py >= size) {
        continue;
      }
      best = {zoom: id.zoom, value: values[py * size + px]};
    }
    return best?.value;
  }

  override get copyrights(): Copyright[] {
    const from = yearOf(this.search.from) ?? this.firstYear;
    const to = yearOf(this.search.to) ?? new Date().getFullYear();
    return this.credit(from === to ? `${from}` : `${from}-${to}`);
  }

  override loadingData(): boolean {
    return this.fetching;
  }

  override render(planner: Planner): void {
    if (this.generation !== this.plan.generation) {
      const buffer =
          new ArrayBuffer(
              Math.max(BillboardProgram.bytesNeeded() * this.tiles.size, TILE_BUFFER_BYTES));
      const drawables = [];
      let offset = 0;

      // Draw lowest detail to highest because tiles share a z and the depth test passes equal
      // depths, so the last one drawn wins.
      const sorted = [...this.tiles].sort((a, b) => a[0].zoom - b[0].zoom);
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

  override viewportChanged(bounds: S2LatLngRect, zoom: number, fetchZoom: number): void {
    const lat = bounds.lat();
    const lng = bounds.lng();
    this.loader.broadcast({
      kind: 'uvr',
      viewport: {
        lat: [lat.lo(), lat.hi()],
        lng: [lng.lo(), lng.hi()],
        zoom: fetchZoom,
      },
    });
  }

  private loadTile(command: LoadTileCommand): void {
    const texture = this.pool.acquire();
    this.renderer.uploadTexture(command.bitmap, texture);

    // A provisional tile is drawn again once more results arrive.
    const replaced = this.tiles.get(command.id);
    if (replaced) {
      this.pool.release(replaced);
    }
    this.tiles.set(command.id, texture);
    if (command.values) {
      this.values.set(command.id, command.values);
    }
    this.redraw();
  }

  private unloadTiles(ids: TileId[]): void {
    for (const id of ids) {
      const texture = this.tiles.get(id);
      if (texture) {
        this.tiles.delete(id);
        this.pool.release(texture);
      }
      this.values.delete(id);
    }

    this.redraw();
  }
}

// Local time, because callers build the instants from local days and a UTC year would put January
// 1st east of UTC in the year before.
function yearOf(instant: string): number|undefined {
  return instant === '..' ? undefined : new Date(instant).getFullYear();
}
