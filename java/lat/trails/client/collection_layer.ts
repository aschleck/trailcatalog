import { S2LatLng, S2LatLngRect } from 'java/org/trailcatalog/s2';
import { checkExhaustive } from 'external/dev_april_corgi+/js/common/asserts';
import { HashMap } from 'external/dev_april_corgi+/js/common/collections';
import { WorkerPool } from 'external/dev_april_corgi+/js/common/worker_pool';
import { Camera } from 'js/map/camera';
import { LatLng, RawUuid, RgbaU32 } from 'js/map/common/types';
import { EventSource, Layer } from 'js/map/layer';
import { LineProgram } from 'js/map/rendering/line_program';
import { Planner } from 'js/map/rendering/planner';
import { Drawable } from 'js/map/rendering/program';
import { Renderer } from 'js/map/rendering/renderer';
import { Request as QuerierRequest, Response as QuerierResponse, QueryPointResponse } from 'js/map/workers/location_querier';
import { CellKey, Command as FetcherCommand, LoadCellCommand, Request as FetcherRequest, Snap, Stream, UnloadCellsCommand } from 'js/map/workers/s2_data_fetcher';
import { Z_USER_DATA } from 'js/map/z';

import { HOVER_CHANGED } from './events';
import { Line, LoadResponse, Request as LoaderRequest, Response as LoaderResponse, Polygon, Style } from './workers/collection_loader';

// White against a black casing, the way trailcatalog draws a hovered trail. The casing is what
// makes it read as lifted, over pale roads and over landcover alike.
const HOVER_FILL = 0xFFFFFFFF as RgbaU32;
const HOVER_STROKE = 0x000000FF as RgbaU32;
// A hovered area keeps its owner's color and just gets more of it, since the color is what the
// layer is for. The boundary does the picking out.
const HOVER_POLYGON_ALPHA = 0xCC;
const HOVER_POLYGON_OUTLINE_RADIUS_PX = 1.5;

// Enough to leave a casing around the line it replaces, and never thinner than the casing needs:
// LineProgram draws the fill a pixel inside the stroke, so under about 3 the white core disappears
// and all that is left is a black line. Same floor trailcatalog draws a raised path at.
const HOVER_LINE_PADDING_PX = 1;
const HOVER_LINE_MIN_RADIUS_PX = 4;

// How close the cursor has to come to a line to hover it, measured from the center, so it reaches
// past the edge of everything but the widest motorway.
const HOVER_RADIUS_PX = 6;

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
  // The bytes each cell arrived as, so that a styleZoom change can re-post them to the loader
  // instead of refetching. Same trade MbtileLayer makes with rawBytes.
  private readonly rawBytes: Map<CellKey, ArrayBuffer>;
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
  // highlight draws it, which leaves the highlight free to be narrower or translucent.
  private lastHoverTarget: RawUuid|undefined;
  private lastRenderGeneration: number;
  // -1 until the first viewport arrives, so that the first cell to land forces a style pass.
  private styleZoom: number;

  constructor(
      url: string,
      style: Style,
      snaps: Snap[],
      streams: Stream[],
      private readonly camera: Camera,
      private readonly renderer: Renderer,
  ) {
    super(/* copyright= */ []);
    this.fetcher = new WorkerPool('/static/s2_data_fetcher_worker.js', 1);
    this.fetching = false;
    this.loader = new WorkerPool('/static/collection_loader_worker.js', 6);
    this.querier = new WorkerPool('/static/location_querier_worker.js', 1);
    this.cells = new Map();
    this.rawBytes = new Map();
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
    this.styleZoom = -1;

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
      style,
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
        radius: HOVER_RADIUS_PX * this.camera.inverseWorldRadius,
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
        radius: HOVER_RADIUS_PX * this.camera.inverseWorldRadius,
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
        const line = object.value;
        highlight.geometry =
            growBuffer(highlight.geometry, LineProgram.bytesNeeded(line.points.length / 2));

        const result =
            LineProgram.push(
                HOVER_FILL,
                HOVER_STROKE,
                Math.max(line.style.radius + HOVER_LINE_PADDING_PX, HOVER_LINE_MIN_RADIUS_PX),
                /* stipple= */ false,
                line.points,
                highlight.geometry,
                /* offset= */ 0);

        const drawable = {
          elements: undefined,
          geometry: highlight.glGeometryBuffer,
          geometryByteLength: result.geometryByteLength,
          geometryOffset: 0,
          instanced: {
            count: result.instanceCount,
          },
          program: this.renderer.lineProgram,
          texture: undefined,
          vertexCount: result.vertexCount,
          z: Z_USER_DATA + 1,
        };
        highlight.drawables.push(drawable);
        // Circles at the joins, or else a corner shows the gap between two unmitered rectangles.
        highlight.drawables.push({...drawable, program: this.renderer.lineCapProgram});

        // Hide the existing object
        this.renderer.uploadDataSubset(
          new ArrayBuffer(line.geometryByteLength),
          line.geometryOffset,
          line.geometryByteLength,
          cell.glGeometryBuffer);
      } else if (object.kind === 'polygon') {
        const polygon = object.value;
        const triangles = polygon.triangles;
        // A fill color rides in front of the vertices, so the buffer holds one extra float.
        const fillByteLength = 4 * (1 + triangles.geometry.length);
        let outlineByteLength = 0;
        for (const ring of polygon.outline) {
          outlineByteLength += LineProgram.bytesNeeded(ring.length / 2);
        }
        highlight.geometry =
            growBuffer(highlight.geometry, fillByteLength + outlineByteLength);
        highlight.index = growBuffer(highlight.index, 4 * triangles.index.length);

        const geometryFloats = new Float32Array(highlight.geometry);
        const geometryUints = new Uint32Array(highlight.geometry);
        geometryUints[0] = raiseAlpha(polygon.style.fill, HOVER_POLYGON_ALPHA);
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
          geometryByteLength: fillByteLength,
          geometryOffset: 0,
          instanced: undefined,
          program: this.renderer.triangleProgram,
          texture: undefined,
          vertexCount: undefined,
          z: Z_USER_DATA + 1,
        });

        // The boundary, above the fill, so the shape reads as picked out rather than just
        // brighter. An owner keeps its own color, which is the whole point of the layer.
        //
        // A ring only ever produces segments of its own, so laying every ring end to end and
        // drawing the lot as one run of instances joins nothing that should not be joined. A state
        // forest reaches a few thousand rings, and one drawable is what keeps the planner from
        // sorting all of them every frame.
        let outlineOffset = fillByteLength;
        let outlineInstances = 0;
        for (const ring of polygon.outline) {
          const result =
              LineProgram.push(
                  HOVER_STROKE,
                  HOVER_STROKE,
                  HOVER_POLYGON_OUTLINE_RADIUS_PX,
                  /* stipple= */ false,
                  ring,
                  highlight.geometry,
                  outlineOffset);
          outlineOffset += result.geometryByteLength;
          outlineInstances += result.instanceCount;
        }

        if (outlineInstances > 0) {
          const drawable = {
            elements: undefined,
            geometry: highlight.glGeometryBuffer,
            geometryByteLength: outlineOffset - fillByteLength,
            geometryOffset: fillByteLength,
            instanced: {
              count: outlineInstances,
            },
            program: this.renderer.lineProgram,
            texture: undefined,
            vertexCount: /* a rectangle per segment= */ 4,
            z: Z_USER_DATA + 2,
          };
          highlight.drawables.push(drawable);
          highlight.drawables.push({...drawable, program: this.renderer.lineCapProgram});
        }

        // Hide the existing object
        this.renderer.uploadDataSubset(
          new ArrayBuffer(polygon.geometryByteLength),
          polygon.geometryOffset,
          polygon.geometryByteLength,
          cell.glGeometryBuffer);

        this.renderer.uploadIndices(
          highlight.index, highlight.index.byteLength, highlight.glIndexBuffer);
      } else {
        throw checkExhaustive(object);
      }

      this.renderer.uploadData(
        highlight.geometry, highlight.geometry.byteLength, highlight.glGeometryBuffer);
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

    // Style bands break on integers, so the floor is the only thing a restyle has to watch.
    const newStyleZoom = Math.floor(zoom);
    if (newStyleZoom !== this.styleZoom) {
      this.styleZoom = newStyleZoom;
      for (const [key, data] of this.rawBytes) {
        this.loader.post({kind: 'lr', key, styleZoom: newStyleZoom, data});
      }
    }
  }

  private loadRawCell(command: LoadCellCommand): void {
    // It takes 2 bytes to return a response indicating no data
    if (command.data.byteLength <= 2) {
      this.release(command.key);
      this.cells.delete(command.key);
      this.rawBytes.delete(command.key);
      return;
    }

    // A cell we already hold is being refined, so it keeps drawing until the finer geometry lands.
    if (!this.cells.has(command.key)) {
      this.cells.set(command.key, undefined);
    }

    // No transfer list, so the worker gets a structured clone and this copy survives to restyle.
    this.rawBytes.set(command.key, command.data);
    this.loader.post({
      kind: 'lr',
      key: command.key,
      styleZoom: this.styleZoom,
      data: command.data,
    });
  }

  private loadProcessedCell(response: LoadResponse): void {
    // Has this already been unloaded?
    if (!this.cells.has(response.key)) {
      return;
    }

    // A restyle at a newer zoom has already gone out, so this answer is for a band nobody is
    // looking at.
    if (response.styleZoom !== this.styleZoom) {
      return;
    }

    // Refining a cell throws out the coarser copy of the same objects, and with it the offsets the
    // highlight blanked into its buffer.
    this.release(response.key);

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
      this.rawBytes.delete(key);
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
        const line = object.value;
        const restored = new ArrayBuffer(line.geometryByteLength);
        LineProgram.push(
            line.style.fill,
            line.style.stroke,
            line.style.radius,
            line.style.stipple,
            line.points,
            restored,
            /* offset= */ 0);
        this.renderer.uploadDataSubset(
          restored, line.geometryOffset, line.geometryByteLength, cell.glGeometryBuffer);
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

function raiseAlpha(color: RgbaU32, alpha: number): RgbaU32 {
  return (((color & 0xFFFFFF00) >>> 0) | alpha) as RgbaU32;
}

function growBuffer(buffer: ArrayBuffer, needed: number): ArrayBuffer {
  if (needed <= buffer.byteLength) {
    return buffer;
  }
  const capacity = Math.pow(2, Math.ceil(Math.log2(needed)) + 1);
  return new ArrayBuffer(capacity);
}
