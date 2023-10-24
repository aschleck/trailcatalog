import { S2LatLng, S2LatLngRect } from 'java/org/trailcatalog/s2';
import { checkExhaustive } from 'js/common/asserts';
import { HashMap } from 'js/common/collections';
import { WorkerPool } from 'js/common/worker_pool';
import { LatLng, RgbaU32, S2CellToken, TileId } from 'js/map2/common/types';
import { EventSource, Layer } from 'js/map2/layer';
import { Planner } from 'js/map2/rendering/planner';
import { Drawable } from 'js/map2/rendering/program';
import { Renderer } from 'js/map2/rendering/renderer';
import { TexturePool } from 'js/map2/rendering/texture_pool';
import { Request as QuerierRequest, Response as QuerierResponse } from 'js/map2/workers/location_querier';
import { Command as FetcherCommand, LoadCellCommand, Request as FetcherRequest, UnloadCellsCommand } from 'js/map2/workers/s2_data_fetcher';
import { Z_USER_DATA } from 'js/map2/z';

import { LoadResponse, Request as LoaderRequest, Response as LoaderResponse } from './workers/collection_loader';

interface LoadedCell {
  drawables: Drawable[];
  glGeometryBuffer: WebGLBuffer;
  glIndexBuffer: WebGLBuffer;
}

export class CollectionLayer extends Layer {

  private readonly fetcher: WorkerPool<FetcherRequest, FetcherCommand>;
  private fetching: boolean;
  private readonly loader: WorkerPool<LoaderRequest, LoaderResponse>;
  private readonly querier: WorkerPool<QuerierRequest, QuerierResponse>;
  private readonly cells: Map<S2CellToken, LoadedCell|undefined>;
  private generation: number;
  private lastRenderGeneration: number;

  constructor(
      url: string,
      indexBottom: number,
      snap: number|undefined,
      private readonly renderer: Renderer,
  ) {
    super(/* copyright= */ []);
    this.fetcher = new WorkerPool('/static/s2_data_fetcher_worker.js', 1);
    this.fetching = false;
    this.loader = new WorkerPool('/static/collection_loader_worker.js', 6);
    this.querier = new WorkerPool('/static/location_querier_worker.js', 1);
    this.cells = new Map();
    this.registerDisposer(() => {
      for (const response of this.cells.values()) {
        if (!response) {
          continue;
        }

        this.renderer.deleteBuffer(response.glGeometryBuffer);
        this.renderer.deleteBuffer(response.glIndexBuffer);
      }
    });
    this.generation = 0;
    this.lastRenderGeneration = -1;

    this.fetcher.onresponse = command => {
      if (command.kind === 'lcc') {
        this.loadRawCell(command);
      } else if (command.kind === 'ucc') {
        this.unloadCells(command);
      } else if (command.kind === 'usc') {
        this.fetching = command.fetching;
      } else {
        checkExhaustive(command);
      }
    };

    this.loader.onresponse = response => {
      if (response.kind === 'lr') {
        this.loadProcessedCell(response);
      } else {
        checkExhaustive(response.kind);
      }
    };

    this.fetcher.broadcast({
      kind: 'ir',
      covering: url + '/covering',
      indexBottom,
      snap,
      url: url + '/objects',
    });
    this.loader.broadcast({
      kind: 'ir',
      style: {
        polygons: [
          {
            filters: [{match: 'string_equals', key: 'owner', value: 'BLM/BR'}],
            fill: 0xFFFF0088 as RgbaU32,
            z: Z_USER_DATA,
          },
          {
            filters: [{match: 'string_equals', key: 'owner', value: 'NPS'}],
            fill: 0x00FF0088 as RgbaU32,
            z: Z_USER_DATA,
          },
          {
            filters: [{match: 'string_equals', key: 'owner', value: 'USFS'}],
            fill: 0x0000FF88 as RgbaU32,
            z: Z_USER_DATA,
          },
          {
            filters: [{match: 'always'}],
            fill: 0xFF000088 as RgbaU32,
            z: Z_USER_DATA,
          },
        ],
      },
    });
    this.querier.broadcast({kind: 'ir'});
  }

  override click(point: S2LatLng, px: [number, number], contextual: boolean, source: EventSource): boolean {
    this.querier.post({
      kind: 'qpr',
      point: [point.latDegrees(), point.lngDegrees()] as const as LatLng,
    });
    return false;
  }

  override hasNewData(): boolean {
    return this.generation !== this.lastRenderGeneration;
  }

  override loadingData(): boolean {
    if (this.fetching) {
      return true;
    }

    for (const response of this.cells.values()) {
      if (!response) {
        return true;
      }
    }
    return false;
  }

  override render(planner: Planner): void {
    for (const response of this.cells.values()) {
      if (!response) {
        continue;
      }

      planner.add(response.drawables);
      this.lastRenderGeneration = this.generation;
    }
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

  private loadRawCell(command: LoadCellCommand): void {
    // It takes 2 bytes to return a response indicating no data
    if (command.data.byteLength <= 2) {
      return;
    }

    this.cells.set(command.token, undefined);
    this.loader.post({
      kind: 'lr',
      token: command.token,
      data: command.data,
    }, [command.data]);
  }

  private loadProcessedCell(response: LoadResponse): void {
    // Has this already been unloaded?
    if (!this.cells.has(response.token)) {
      return;
    }

    if (response.polygons.length === 0) {
      return;
    }

    const geometry = this.renderer.createDataBuffer(response.geometry.byteLength);
    const index = this.renderer.createIndexBuffer(response.index.byteLength);
    this.renderer.uploadData(response.geometry, response.geometry.byteLength, geometry);
    this.renderer.uploadIndices(response.index, response.index.byteLength, index);
    const drawables = [];

    this.querier.post({
      kind: 'lr',
      groupId: response.token,
      polygons: response.polygons,
    });

    for (const polygon of response.polygonalGeometries) {
      drawables.push({
        elements: {
          count: polygon.indexCount,
          index,
          offset: polygon.indexOffset,
        },
        geometry,
        geometryByteLength: polygon.geometryByteLength,
        geometryOffset: polygon.geometryOffset,
        instanced: undefined,
        program: this.renderer.triangleProgram,
        texture: undefined,
        vertexCount: undefined,
        z: polygon.z,
      });
    }

    this.cells.set(response.token, {
      glGeometryBuffer: geometry,
      glIndexBuffer: index,
      drawables,
    });
    this.generation += 1;
  }

  private unloadCells(command: UnloadCellsCommand): void {
    this.querier.post({
      kind: 'ur',
      groupIds: command.tokens,
    });

    for (const token of command.tokens) {
      const response = this.cells.get(token);
      if (response) {
        this.cells.delete(token);
        this.renderer.deleteBuffer(response.glGeometryBuffer);
        this.renderer.deleteBuffer(response.glIndexBuffer);
      }
    }
    this.generation += 1;
  }
}

