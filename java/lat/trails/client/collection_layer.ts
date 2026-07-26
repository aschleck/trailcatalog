import { S2LatLng, S2LatLngRect } from 'java/org/trailcatalog/s2';
import { checkExhaustive } from 'external/dev_april_corgi+/js/common/asserts';
import { HashMap } from 'external/dev_april_corgi+/js/common/collections';
import { WorkerPool } from 'external/dev_april_corgi+/js/common/worker_pool';
import { LatLng, RawUuid, RgbaU32 } from 'js/map/common/types';
import { EventSource, Layer } from 'js/map/layer';
import { Planner } from 'js/map/rendering/planner';
import { Drawable } from 'js/map/rendering/program';
import { Renderer } from 'js/map/rendering/renderer';
import { Request as QuerierRequest, Response as QuerierResponse, QueryPointResponse } from 'js/map/workers/location_querier';
import { CellKey, Command as FetcherCommand, LoadCellCommand, Request as FetcherRequest, Snap, Stream, UnloadCellsCommand } from 'js/map/workers/s2_data_fetcher';
import { Z_USER_DATA } from 'js/map/z';

import { HOVER_CHANGED } from './events';
import { Line, LoadResponse, Request as LoaderRequest, Response as LoaderResponse, Polygon } from './workers/collection_loader';

interface LoadedCell {
  drawables: Drawable[];
  glGeometryBuffer: WebGLBuffer;
  glIndexBuffer: WebGLBuffer;
  lines: Line[];
  polygons: Polygon[];
}

// The object the cursor is over, drawn from its own buffers so it can sit above its cell. Which
// object that is lives in lastHoverTarget.
interface Highlight {
  drawables: Drawable[];
  geometry: ArrayBuffer;
  glGeometryBuffer: WebGLBuffer;
  glIndexBuffer: WebGLBuffer;
  index: ArrayBuffer;
}

export class CollectionLayer extends Layer {

  private readonly fetcher: WorkerPool<FetcherRequest, FetcherCommand>;
  private fetching: boolean;
  private readonly loader: WorkerPool<LoaderRequest, LoaderResponse>;
  private readonly querier: WorkerPool<QuerierRequest, QuerierResponse>;
  private readonly cells: Map<CellKey, LoadedCell|undefined>;
  private readonly objects:
    HashMap<
      RawUuid,
      | {kind: 'line'; key: CellKey; value: Line}
      | {kind: 'polygon'; key: CellKey; value: Polygon}
    >;
  private activeQuery: {
    id: number;
    resolve: (response: QueryPointResponse) => void;
    reject: () => void;
  };
  private generation: number;
  private readonly highlight: Highlight;
  // The object the highlight is drawing. Its geometry is blanked in its own cell so that only the
  // highlight draws it.
  private lastHoverTarget: RawUuid|undefined;
  private lastRenderGeneration: number;

  constructor(
      url: string,
      snaps: Snap[],
      streams: Stream[],
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
      for (const cell of this.cells.values()) {
        if (cell) {
          this.renderer.deleteBuffer(cell.glGeometryBuffer);
          this.renderer.deleteBuffer(cell.glIndexBuffer);
        }
      }
    });
    this.activeQuery = {id: -1, resolve: () => {}, reject: () => {}};
    this.generation = 0;
    this.highlight = {
      drawables: [],
      geometry: new ArrayBuffer(/* length= */ 64 * 1024),
      index: new ArrayBuffer(/* length= */ 64 * 1024),
      glGeometryBuffer: this.renderer.createDataBuffer(/* byteSize= */ 64 * 1024),
      glIndexBuffer: this.renderer.createIndexBuffer(/* byteSize= */ 64 * 1024),
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
      snaps,
      streams,
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
      // A point can land in several nested units, so take the first one we still hold.
      const target = response.ids.find(id => this.objects.has(id));
      if (target?.msb === this.lastHoverTarget?.msb && target?.lsb === this.lastHoverTarget?.lsb) {
        return;
      }

      this.lastRenderGeneration += 1;
      this.clearHighlight();
      this.lastHoverTarget = target;
      const highlight = this.highlight;

      const object = target ? this.objects.get(target) : undefined;
      source.trigger(HOVER_CHANGED, {target: object?.value});
      if (!object) {
        return;
      }

      const cell = this.cells.get(object.key);
      if (!cell) {
        return;
      }

      if (object.kind === 'line') {
        // TODO(april)
      } else if (object.kind === 'polygon') {
        const polygon = object.value;
        const triangles = polygon.triangles;
        // A fill color rides in front of the vertices, so the buffer holds one extra float.
        highlight.geometry =
            growBuffer(highlight.geometry, 4 * (1 + triangles.geometry.length));
        highlight.index = growBuffer(highlight.index, 4 * triangles.index.length);

        const geometryFloats = new Float32Array(highlight.geometry);
        const geometryUints = new Uint32Array(highlight.geometry);
        geometryUints[0] = 0xFFFFFF88;
        geometryFloats.set(triangles.geometry, /* offset= */ 1);
        const index = new Uint32Array(highlight.index);
        index.set(triangles.index);

        highlight.drawables.push({
          elements: {
            count: triangles.index.length,
            index: highlight.glIndexBuffer,
            offset: 0,
          },
          geometry: highlight.glGeometryBuffer,
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
        highlight.geometry, highlight.geometry.byteLength, highlight.glGeometryBuffer);
      this.renderer.uploadIndices(
        highlight.index, highlight.index.byteLength, highlight.glIndexBuffer);
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

    for (const cell of this.cells.values()) {
      if (!cell) {
        return true;
      }
    }
    return false;
  }

  override render(planner: Planner): void {
    for (const cell of this.cells.values()) {
      if (cell) {
        planner.add(cell.drawables);
      }
    }

    planner.add(this.highlight.drawables);
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
      this.release(command.key);
      this.cells.delete(command.key);
      return;
    }

    // A cell we already hold is being refined, so it keeps drawing until the finer geometry lands.
    if (!this.cells.has(command.key)) {
      this.cells.set(command.key, undefined);
    }

    this.loader.post({
      kind: 'lr',
      key: command.key,
      data: command.data,
    }, [command.data]);
  }

  private loadProcessedCell(response: LoadResponse): void {
    // Has this already been unloaded?
    if (!this.cells.has(response.key)) {
      return;
    }

    // Refining a cell throws out the coarser copy of the same objects, and with it the offsets the
    // highlight blanked into its buffer.
    this.release(response.key);

    // Nothing in the cell matched the style, so there is nothing to wait for either.
    if (response.lines.length === 0 && response.polygons.length === 0) {
      this.cells.delete(response.key);
      this.generation += 1;
      return;
    }

    for (const line of response.lines) {
      this.objects.set(line.id, {kind: 'line', key: response.key, value: line});
    }
    for (const polygon of response.polygons) {
      this.objects.set(polygon.id, {kind: 'polygon', key: response.key, value: polygon});
    }

    this.querier.post({
      kind: 'lr',
      groupId: response.key,
      lines: response.lines.map(line => ({id: line.id, points: line.points})),
      polygons: response.polygons.map(polygon => ({
        id: polygon.id,
        bound: polygon.bound,
        raw: polygon.raw,
      })),
    });

    const geometry = this.renderer.createDataBuffer(response.geometry.byteLength);
    const index = this.renderer.createIndexBuffer(response.index.byteLength);
    this.renderer.uploadData(response.geometry, response.geometry.byteLength, geometry);
    this.renderer.uploadIndices(response.index, response.index.byteLength, index);
    const drawables = [];

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

    this.cells.set(response.key, {
      glGeometryBuffer: geometry,
      glIndexBuffer: index,
      drawables,
      lines: response.lines,
      polygons: response.polygons,
    });
    this.generation += 1;
  }

  private unloadCells(command: UnloadCellsCommand): void {
    for (const key of command.keys) {
      this.release(key);
      this.cells.delete(key);
    }
    this.generation += 1;
  }

  // Throws out everything a cell owns, either because it left the viewport or because finer
  // geometry is about to replace it. The caller decides what the cell becomes.
  private release(key: CellKey): void {
    const cell = this.cells.get(key);
    if (!cell) {
      return;
    }

    for (const line of cell.lines) {
      this.objects.delete(line.id);
    }
    for (const polygon of cell.polygons) {
      this.objects.delete(polygon.id);
    }
    this.querier.post({kind: 'ur', groupIds: [key]});

    this.renderer.deleteBuffer(cell.glGeometryBuffer);
    this.renderer.deleteBuffer(cell.glIndexBuffer);

    // The highlight blanked geometry in a buffer that is now gone, so there is nothing to put back.
    if (this.lastHoverTarget && !this.objects.has(this.lastHoverTarget)) {
      this.dropHighlight();
    }
  }

  // Puts back the geometry the highlight hid, then stops drawing it.
  private clearHighlight(): void {
    const object = this.lastHoverTarget ? this.objects.get(this.lastHoverTarget) : undefined;
    const cell = object ? this.cells.get(object.key) : undefined;
    if (object && cell) {
      if (object.kind === 'line') {
        // TODO(april): lines never got hidden, so there is nothing to put back.
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

    this.dropHighlight();
  }

  private dropHighlight(): void {
    this.highlight.drawables.length = 0;
    this.lastHoverTarget = undefined;
  }
}

function growBuffer(buffer: ArrayBuffer, needed: number): ArrayBuffer {
  if (needed <= buffer.byteLength) {
    return buffer;
  }
  const capacity = Math.pow(2, Math.ceil(Math.log2(needed)) + 1);
  return new ArrayBuffer(capacity);
}
