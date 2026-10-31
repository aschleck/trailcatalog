import { S2LatLngRect } from 'java/org/trailcatalog/s2';
import { checkExhaustive } from 'external/dev_april_corgi+/js/common/asserts';
import { HashMap } from 'external/dev_april_corgi+/js/common/collections';
import { Task } from 'external/dev_april_corgi+/js/common/queued_worker_pool';

import { SphericalCone } from '../camera';
import { Copyright, TileId } from '../common/types';
import { Layer } from '../layer';
import { Planner } from '../rendering/planner';
import { Drawable } from '../rendering/program';
import { Renderer } from '../rendering/renderer';
import { forgetFailedTiles, PoolClient, sharedPool, toViewport, Viewport } from '../workers/client_pool';
import { Channel } from '../workers/weather';
import { Initialize as LoaderInitialize, Request as LoaderRequest, Response as LoaderResponse, TraceResponse, WindStyle } from '../workers/wind_loader';
import { Command as FetcherCommand, Initialize as FetcherInitialize, LoadTileCommand, Request as FetcherRequest } from '../workers/xyz_data_fetcher';

/**
 * Draws ECMWF wind tiles as streamlines whose length is the speed, or as station model barbs.
 */
export class WindVectorLayer extends Layer {

  private readonly buffer: WebGLBuffer;
  private readonly fetcher: PoolClient<FetcherInitialize, FetcherRequest, FetcherCommand>;
  private fetching: boolean;
  // Set once the fetcher has started on a viewport, because until then nothing is loading either
  private started: boolean;
  private readonly loader: PoolClient<LoaderInitialize, LoaderRequest, LoaderResponse>;
  private readonly loading: HashMap<TileId, Task<LoaderResponse>>;
  private style: WindStyle|undefined;
  private tracing: Task<LoaderResponse>|undefined;
  private viewport: Viewport|undefined;
  // The arguments of the last viewportChanged, so turning on a style can fetch for it
  private lastViewport: Parameters<Layer['viewportChanged']>|undefined;
  private drawable: Drawable|undefined;

  constructor(
      copyrights: Copyright[],
      url: string,
      private readonly z: number,
      maxZoom: number,
      // in pixels on a side
      tileSize: number,
      private readonly renderer: Renderer,
      // the archive's, which hold u and v
      channels: Channel[],
  ) {
    super(copyrights);
    this.buffer = this.renderer.createDataBuffer(0);
    this.registerDisposer(() => { this.renderer.deleteBuffer(this.buffer); });
    this.fetcher =
        sharedPool<FetcherInitialize, FetcherRequest, FetcherCommand>(
            new URL('xyz_data_fetcher_worker.js', import.meta.url).href, /* count= */ 1)
            .connect({url, extraZoom: 0, minZoom: 0, maxZoom});
    this.fetching = false;
    this.started = false;
    // One worker, so that a trace sees every tile
    this.loader =
        sharedPool<LoaderInitialize, LoaderRequest, LoaderResponse>(
            new URL('wind_loader_worker.js', import.meta.url).href, /* count= */ 1)
            .connect({channels, maxZoom, tileSize});
    this.registerDisposer(() => {
      this.fetcher.dispose();
      this.loader.dispose();
    });
    this.loading = new HashMap(id => `${id.zoom},${id.x},${id.y}`);
    this.style = undefined;
    this.tracing = undefined;
    this.viewport = undefined;
    this.lastViewport = undefined;
    this.drawable = undefined;

    this.fetcher.onresponse = command => {
      if (command.kind === 'ltc') {
        this.loadTile(command);
      } else if (command.kind === 'utc') {
        this.unloadTiles(command.ids);
      } else if (command.kind === 'usc') {
        this.fetching = command.fetching;
        this.started ||= command.fetching;
        this.redraw();
      } else {
        checkExhaustive(command);
      }
    };

    this.loader.onresponse = response => {
      if (response.kind === 'lr') {
        this.loading.delete(response.id);
        this.fetcher.broadcast({
          kind: 'tlr',
          id: response.id,
        });
        this.trace();
      } else if (response.kind === 'tr') {
        this.loadStreamlines(response);
      } else {
        checkExhaustive(response);
      }
    };

    this.loader.onfailure = forgetFailedTiles(this.loading, this.fetcher, () => { this.redraw(); });
  }

  /** Draws the wind in the style, or nothing and fetches nothing when undefined. */
  setStyle(style: WindStyle|undefined): void {
    if (style === this.style) {
      return;
    }
    this.style = style;
    if (!style) {
      this.tracing?.cancel();
      this.tracing = undefined;
      this.drawable = undefined;
      this.redraw();
    } else if (this.lastViewport) {
      this.viewportChanged(...this.lastViewport);
    }
  }

  /** Returns whether the viewport's streamlines are traced, which is trivially so for no style. */
  get ready(): boolean {
    return !this.style || (this.started && !this.loadingData());
  }

  override loadingData(): boolean {
    return this.fetching || this.loading.size > 0 || !!this.tracing;
  }

  override render(planner: Planner): void {
    if (this.drawable) {
      planner.add([this.drawable]);
    }
  }

  override viewportChanged(
      bounds: S2LatLngRect, zoom: number, fetchZoom: number, cone?: SphericalCone): void {
    this.loader.start();
    this.lastViewport = [bounds, zoom, fetchZoom, cone];
    if (!this.style) {
      return;
    }
    this.fetcher.broadcast({kind: 'uvr', viewport: toViewport(bounds, fetchZoom, cone)});
    this.viewport = toViewport(bounds, zoom, cone);
    this.trace();
  }

  private loadTile(command: LoadTileCommand): void {
    if (command.data.byteLength === 0) {
      this.fetcher.broadcast({
        kind: 'tlr',
        id: command.id,
      });
      return;
    }

    const task = this.loader.post({
      kind: 'lr',
      id: command.id,
      data: command.data,
    }, [command.data]);
    this.loading.set(command.id, task);
  }

  private unloadTiles(ids: TileId[]): void {
    for (const id of ids) {
      this.loading.get(id)?.cancel();
      this.loading.delete(id);
    }
    this.loader.broadcast({
      kind: 'ur',
      ids,
    });
    this.trace();
  }

  // Retraces for the newest viewport and tiles. Tasks run in order, so a trace posted after a
  // tile's load sees it.
  private trace(): void {
    if (!this.style || !this.viewport) {
      return;
    }
    this.tracing?.cancel();
    this.tracing = this.loader.post({
      kind: 'tr',
      style: this.style,
      viewport: this.viewport,
    });
    this.redraw();
  }

  private loadStreamlines(response: TraceResponse): void {
    this.tracing = undefined;
    this.redraw();
    if (response.instanceCount === 0) {
      this.drawable = undefined;
      return;
    }
    this.renderer.uploadData(response.geometry, response.geometryByteLength, this.buffer);
    this.drawable = {
      elements: undefined,
      geometry: this.buffer,
      geometryByteLength: response.geometryByteLength,
      geometryOffset: 0,
      instanced: {
        count: response.instanceCount,
      },
      program: this.renderer.lineProgram,
      texture: undefined,
      vertexCount: 4,
      z: this.z,
    };
  }
}
