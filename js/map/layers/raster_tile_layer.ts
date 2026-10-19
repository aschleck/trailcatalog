import { S2LatLng, S2LatLngRect } from 'java/org/trailcatalog/s2';
import { checkExhaustive } from 'external/dev_april_corgi+/js/common/asserts';
import { HashMap } from 'external/dev_april_corgi+/js/common/collections';
import { Task } from 'external/dev_april_corgi+/js/common/queued_worker_pool';

import { projectS2LatLng, SphericalCone } from '../camera';
import { Copyright, RgbaU32, TileId, Vec2 } from '../common/types';
import { Layer } from '../layer';
import { BillboardProgram } from '../rendering/billboard_program';
import { Planner } from '../rendering/planner';
import { Drawable } from '../rendering/program';
import { Renderer } from '../rendering/renderer';
import { TexturePool } from '../rendering/texture_pool';
import { loaderCount, PoolClient, sharedPool } from '../workers/client_pool';
import { Decode, Initialize as LoaderInitialize, LoadResponse, Request as LoaderRequest, Response as LoaderResponse } from '../workers/raster_loader';
import { Command as FetcherCommand, Initialize as FetcherInitialize, LoadTileCommand, Request as FetcherRequest } from '../workers/xyz_data_fetcher';

const MAX_IN_FLIGHT = 32;
const NO_OFFSET: Vec2 = [0, 0];
// A billboard curves onto the globe as a 4x4 lattice, so a z3 tile's cells are 11 degrees across
// and visibly slide as the globe flattens. Coarser tiles are drawn as z7 pieces, whose cells are
// 0.7 degrees.
const PIECE_ZOOM = 7;
// Splitting a z0 tile into z7 pieces would be 16k instances, so tiles that coarse stop at 16x16.
// Those only draw zoomed out, where a 5.6 degree cell is a few pixels.
const MAX_PIECES = 16;

export class RasterTileLayer extends Layer {

  private readonly buffer: WebGLBuffer;
  private readonly fetcher: PoolClient<FetcherInitialize, FetcherRequest, FetcherCommand>;
  private fetching: boolean;
  private readonly loader: PoolClient<LoaderInitialize, LoaderRequest, LoaderResponse>;
  private readonly loading: HashMap<TileId, Task<LoaderResponse>>;
  // Each tile's RGBA before coloring, for the decodes that pack values
  private readonly packed: HashMap<TileId, Uint8ClampedArray>;
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
      decode: Decode = 'image',
  ) {
    super(copyrights);
    this.buffer = this.renderer.createDataBuffer(0);
    this.registerDisposer(() => { this.renderer.deleteBuffer(this.buffer); });
    this.fetcher =
        sharedPool<FetcherInitialize, FetcherRequest, FetcherCommand>(
            new URL('xyz_data_fetcher_worker.js', import.meta.url).href, /* count= */ 1)
            .connect({url, extraZoom, minZoom, maxZoom, maxInFlight: MAX_IN_FLIGHT});
    this.fetching = false;
    this.loader =
        sharedPool<LoaderInitialize, LoaderRequest, LoaderResponse>(
            new URL('raster_loader_worker.js', import.meta.url).href, loaderCount())
            .connect({decode});
    this.registerDisposer(() => {
      this.fetcher.dispose();
      this.loader.dispose();
    });
    this.loading = new HashMap(id => `${id.zoom},${id.x},${id.y}`);
    this.packed = new HashMap(id => `${id.zoom},${id.x},${id.y}`);
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

    // A tile whose load failed would otherwise count as loading forever
    this.loader.onfailure = (request, task) => {
      if (request.kind === 'lr' && this.loading.get(request.id) === task) {
        this.loading.delete(request.id);
        this.fetcher.broadcast({
          kind: 'tlr',
          id: request.id,
        });
      }
    };
  }

  /** Swaps in tiles from another URL template, such as another day's. */
  setUrl(url: string): void {
    this.fetcher.broadcast({
      kind: 'sur',
      url,
    });
  }

  /**
   * Returns the 24 packed bits of the most detailed loaded pixel under the point, for a decode
   * whose pixels pack values.
   */
  packedAt(point: S2LatLng): number|undefined {
    const [x, y] = projectS2LatLng(point);
    let best: {zoom: number; packed: number}|undefined = undefined;
    for (const [id, rgba] of this.packed) {
      if (best && best.zoom >= id.zoom) {
        continue;
      }

      const size = Math.sqrt(rgba.length / 4);
      const tiles = 2 ** id.zoom;
      const px = Math.floor(((x + 1) / 2 * tiles - id.x) * size);
      const py = Math.floor(((1 - y) / 2 * tiles - id.y) * size);
      if (px < 0 || py < 0 || px >= size || py >= size) {
        continue;
      }
      const i = 4 * (py * size + px);
      best = {zoom: id.zoom, packed: (rgba[i] << 16) | (rgba[i + 1] << 8) | rgba[i + 2]};
    }
    return best?.packed;
  }

  override hasNewData(): boolean {
    return this.generation !== this.plan.generation;
  }

  override loadingData(): boolean {
    return this.fetching || this.loading.size > 0;
  }

  override render(planner: Planner): void {
    if (this.hasNewData()) {
      let instances = 0;
      for (const [id] of this.tiles) {
        instances += piecesPerSide(id.zoom) ** 2;
      }
      const buffer = new ArrayBuffer(Math.max(BillboardProgram.bytesNeeded() * instances, 65536));
      const drawables = [];
      let offset = 0;

      // Draw lowest detail to highest because tiles share a z and the depth test passes equal
      // depths, so the last one drawn wins.
      const sorted = [...this.tiles].sort((a, b) => a[0].zoom - b[0].zoom);
      for (const [id, texture] of sorted) {
        const halfWorldSize = Math.pow(2, id.zoom - 1);
        const pieces = piecesPerSide(id.zoom);
        const size = 1 / halfWorldSize / pieces;
        const left = (id.x - halfWorldSize) / halfWorldSize;
        const top = (halfWorldSize - id.y) / halfWorldSize;
        for (let y = 0; y < pieces; ++y) {
          for (let x = 0; x < pieces; ++x) {
            const {byteSize, drawable} =
                this.renderer.billboardProgram.plan(
                    [left + size * (x + 0.5), top - size * (y + 0.5)],
                    NO_OFFSET,
                    [size, size],
                    /* angle= */ 0,
                    this.tint,
                    this.z,
                    /* atlasIndex= */ y * pieces + x,
                    /* atlasSize= */ [pieces, pieces],
                    buffer,
                    offset,
                    this.buffer,
                    texture);
            drawables.push(drawable);
            offset += byteSize;
          }
        }
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
    // The texture holds its own copy, and the bitmap's pixels sit outside the heap until a GC gets
    // around to its wrapper.
    response.bitmap.close();

    this.loading.delete(response.id);
    this.tiles.set(response.id, texture);
    if (response.packed) {
      this.packed.set(response.id, response.packed);
    }
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

      this.packed.delete(id);
      const texture = this.tiles.get(id);
      if (texture) {
        this.tiles.delete(id);
        this.pool.release(texture);
      }
    }

    this.generation += 1;
  }
}

function piecesPerSide(zoom: number): number {
  return Math.min(2 ** Math.max(PIECE_ZOOM - zoom, 0), MAX_PIECES);
}
