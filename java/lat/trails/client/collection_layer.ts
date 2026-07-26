import { S2LatLng, S2LatLngRect } from 'java/org/trailcatalog/s2';
import { checkExhaustive } from 'external/dev_april_corgi+/js/common/asserts';
import { HashMap } from 'external/dev_april_corgi+/js/common/collections';
import { WorkerPool } from 'external/dev_april_corgi+/js/common/worker_pool';
import { LatLng, RawUuid, RgbaU32, S2CellToken, TileId } from 'js/map/common/types';
import { EventSource, Layer } from 'js/map/layer';
import { Planner } from 'js/map/rendering/planner';
import { Drawable } from 'js/map/rendering/program';
import { Renderer } from 'js/map/rendering/renderer';
import { TexturePool } from 'js/map/rendering/texture_pool';
import { Request as QuerierRequest, Response as QuerierResponse, QueryPointResponse } from 'js/map/workers/location_querier';
import { LineProgram } from 'js/map/rendering/line_program';
import { Command as FetcherCommand, LoadCellCommand, Request as FetcherRequest, UnloadCellsCommand } from 'js/map/workers/s2_data_fetcher';
import { Z_USER_DATA } from 'js/map/z';

import { HOVER_CHANGED } from './events';
import { Line, LineGeometry, LoadResponse, Request as LoaderRequest, Response as LoaderResponse, Polygon, PolygonGeometry } from './workers/collection_loader';

interface LoadedCell {
  drawables: Drawable[];
  glGeometryBuffer: WebGLBuffer;
  glIndexBuffer: WebGLBuffer;
  objects: RawUuid[];
}

export class CollectionLayer extends Layer {

  private readonly fetcher: WorkerPool<FetcherRequest, FetcherCommand>;
  private fetching: boolean;
  private readonly loader: WorkerPool<LoaderRequest, LoaderResponse>;
  private readonly querier: WorkerPool<QuerierRequest, QuerierResponse>;
  private readonly cells: Map<S2CellToken, LoadedCell|undefined>;
  private readonly objects:
    HashMap<
      RawUuid,
      | {kind: 'line'; cell: S2CellToken; value: Line}
      | {kind: 'polygon'; cell: S2CellToken; value: Polygon}
    >;
  private activeQuery: {
    id: number;
    resolve: (response: QueryPointResponse) => void;
    reject: () => void;
  };
  private generation: number;
  private interactiveData: LoadedCell & {
    geometry: ArrayBuffer;
    index: ArrayBuffer;
  };
  private lastHoverTarget: RawUuid|undefined;
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
    this.objects = new HashMap(key => `${key.msb}-${key.lsb}`);
    this.registerDisposer(() => {
      for (const response of this.cells.values()) {
        if (!response) {
          continue;
        }

        this.renderer.deleteBuffer(response.glGeometryBuffer);
        this.renderer.deleteBuffer(response.glIndexBuffer);
      }
    });
    this.activeQuery = {id: -1, resolve: () => {}, reject: () => {}};
    this.generation = 0;
    this.interactiveData = {
      drawables: [],
      geometry: new ArrayBuffer(/* length= */ 64 * 1024),
      index: new ArrayBuffer(/* length= */ 64 * 1024),
      glGeometryBuffer: this.renderer.createDataBuffer(/* byteSize= */ 64 * 1024),
      glIndexBuffer: this.renderer.createIndexBuffer(/* byteSize= */ 64 * 1024),
      objects: [],
    };
    this.lastHoverTarget = undefined;
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

    this.querier.onresponse = response => {
      if (this.activeQuery.id === response.generation) {
        this.activeQuery.resolve(response);
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
        lines: [],
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
    new Promise((resolve, reject) => {
      const id = this.activeQuery.id + 1;
      this.activeQuery.reject();
      this.activeQuery = {id, resolve, reject};
      this.querier.post({
        kind: 'qpr',
        generation: id,
        point: [point.latDegrees(), point.lngDegrees()] as const as LatLng,
      });
    }).then(response => {
      console.log(response);
    }).catch(() => {});
    return false;
  }

  override hover(point: S2LatLng, source: EventSource): boolean {
    new Promise<QueryPointResponse>((resolve, reject) => {
      const id = this.activeQuery.id + 1;
      this.activeQuery.reject();
      this.activeQuery = {id, resolve, reject};
      this.querier.post({
        kind: 'qpr',
        generation: id,
        point: [point.latDegrees(), point.lngDegrees()] as const as LatLng,
      });
    }).then(response => {
      const target: RawUuid|undefined = response.ids[0];
      if (target?.msb === this.lastHoverTarget?.msb && target?.lsb === this.lastHoverTarget?.lsb) {
        return;
      }

      this.lastHoverTarget = target;
      this.lastRenderGeneration += 1;
      const interactive = this.interactiveData;

      for (const id of interactive.objects) {
        const object = this.objects.get(id);
        if (!object) {
          continue;
        }
        const cell = this.cells.get(object.cell);
        if (!cell) {
          continue;
        }

        // Restore the cleared original geometry
        if (object.kind === 'line') {
        } else if (object.kind === 'polygon') {
          const polygon = object.value;
          this.renderer.uploadDataSubset(
            Float32Array.from(polygon.triangles.geometry).buffer,
            polygon.geometryOffset,
            polygon.geometryByteLength,
            cell.glGeometryBuffer);
        } else {
          throw checkExhaustive(object);
        }
      }

      interactive.drawables.length = 0;
      interactive.objects.length = 0;

      const object = this.objects.get(target);
      source.trigger(HOVER_CHANGED, {target: object?.value});
      if (target) {
        interactive.objects.push(target);
      }

      if (!object) {
        return;
      }

      const cell = this.cells.get(object.cell);
      if (!cell) {
        return;
      }

      if (object.kind === 'line') {
        // TODO(april)
      } else if (object.kind === 'polygon') {
        const polygon = object.value;
        const triangles = polygon.triangles;
        interactive.geometry = growBuffer(interactive.geometry, 1 + 4 * triangles.geometry.length);
        interactive.index = growBuffer(interactive.index, 4 * triangles.index.length);

        const geometryFloats = new Float32Array(interactive.geometry);
        const geometryUints = new Uint32Array(interactive.geometry);
        geometryUints[0] = 0xFFFFFF88;
        geometryFloats.set(triangles.geometry, /* offset= */ 1);
        const index = new Uint32Array(interactive.index);
        index.set(triangles.index);

        interactive.drawables.push({
          elements: {
            count: triangles.index.length,
            index: interactive.glIndexBuffer,
            offset: 0,
          },
          geometry: interactive.glGeometryBuffer,
          geometryByteLength: 4 * (1 + triangles.geometry.length),
          geometryOffset: 0,
          instanced: undefined,
          program: this.renderer.triangleProgram,
          texture: undefined,
          vertexCount: undefined,
          z: Z_USER_DATA + 1,
        });

        // Hide the existing object
        this.renderer.uploadDataSubset(
          new ArrayBuffer(polygon.geometryByteLength),
          polygon.geometryOffset,
          polygon.geometryByteLength,
          cell.glGeometryBuffer);
      } else {
        throw checkExhaustive(object);
      }

      this.renderer.uploadData(
        interactive.geometry, interactive.geometry.byteLength, interactive.glGeometryBuffer);
      this.renderer.uploadIndices(
        interactive.index, interactive.index.byteLength, interactive.glIndexBuffer);
    }).catch(() => {});
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
    }

    planner.add(this.interactiveData.drawables);
    this.lastRenderGeneration = this.generation;
  }

  override viewportChanged(bounds: S2LatLngRect, zoom: number, fetchZoom: number): void {
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

    if (response.lines.length === 0 && response.polygons.length === 0) {
      return;
    }

    const objects = [];
    for (const line of response.lines) {
      this.objects.set(line.id, {kind: 'line', cell: response.token, value: line});
      objects.push(line.id);
    }

    for (const polygon of response.polygons) {
      this.objects.set(polygon.id, {kind: 'polygon', cell: response.token, value: polygon});
      objects.push(polygon.id);
    }

    const geometry = this.renderer.createDataBuffer(response.geometry.byteLength);
    const index = this.renderer.createIndexBuffer(response.index.byteLength);
    this.renderer.uploadData(response.geometry, response.geometry.byteLength, geometry);
    this.renderer.uploadIndices(response.index, response.index.byteLength, index);
    const drawables = [];

    this.querier.post({
      kind: 'lr',
      groupId: response.token,
      lines: response.lines,
      polygons: response.polygons,
    });

    for (const line of response.lineGeometries) {
      drawables.push({
        elements: undefined,
        geometry,
        geometryByteLength: line.geometryByteLength,
        geometryOffset: line.geometryOffset,
        instanced: {
          count: line.instanceCount,
        },
        program: this.renderer.lineProgram,
        texture: undefined,
        vertexCount: line.vertexCount,
        z: line.z,
      });
    }

    for (const polygon of response.polygonGeometries) {
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
      objects,
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
        for (const id of response.objects) {
          this.objects.delete(id);
        }

        this.renderer.deleteBuffer(response.glGeometryBuffer);
        this.renderer.deleteBuffer(response.glIndexBuffer);
      }
    }
    this.generation += 1;
  }
}

function growBuffer(buffer: ArrayBuffer, needed: number): ArrayBuffer {
  if (needed <= buffer.byteLength) {
    return buffer;
  }
  const capacity = Math.pow(2, Math.ceil(Math.log2(needed)) + 1);
  return new ArrayBuffer(capacity);
}
