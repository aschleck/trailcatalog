import { S2LatLng, S2LatLngRect } from 'java/org/trailcatalog/s2';
import { SimpleS2 } from 'java/org/trailcatalog/s2/SimpleS2';
import { checkExhaustive } from 'external/dev_april_corgi+/js/common/asserts';
import { Task } from 'external/dev_april_corgi+/js/common/queued_worker_pool';
import { Camera, projectS2LatLng } from 'js/map/camera';
import { Copyright, RawUuid, RgbaU32 } from 'js/map/common/types';
import { EventSource, Layer } from 'js/map/layer';
import { growBuffer } from 'js/map/rendering/buffers';
import { LineProgram, Stipple } from 'js/map/rendering/line_program';
import { Planner } from 'js/map/rendering/planner';
import { Drawable } from 'js/map/rendering/program';
import { Renderer } from 'js/map/rendering/renderer';
import { loaderCount, PoolClient, sharedPool } from 'js/map/workers/client_pool';
import { LocationIndex } from 'js/map/workers/location_index';
import { CellKey, Command as FetcherCommand, Initialize as FetcherInitialize, LoadCellCommand, Request as FetcherRequest, Snap, Stream, UnloadCellsCommand } from 'js/map/workers/s2_data_fetcher';
import { Z_USER_DATA, Z_USER_DATA_HIGHLIGHT } from 'js/map/z';

import { DOUBLE_CLICK_MS, HOVER_CHANGED, OBJECT_OPENED } from './events';
import { Schema } from './schema';
import { Initialize as LoaderInitialize, Line, LoadedLines, LoadResponse, Point, Request as LoaderRequest, Response as LoaderResponse, Polygon, Style } from './workers/collection_loader';
import { Match } from './workers/filters';

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
// Hovered points get bigger instead of changing color, because the color shows the data.
const HOVER_POINT_PADDING_PX = 2;

const NO_STYLE: Style = {lines: [], points: [], polygons: []};

// How close the cursor has to come to a line to hover it, measured from the center, so it reaches
// past the edge of everything but the widest motorway.
const HOVER_RADIUS_PX = 6;

interface LoadedCell {
  drawables: Drawable[];
  glGeometryBuffer: WebGLBuffer;
  glIndexBuffer: WebGLBuffer;
  lines: LoadedLines;
  // Counts loads across every cell, so that a line id the index answered with before this cell
  // was restyled can't name whatever line took its index since.
  serial: number;
  points: Point[];
  polygons: Polygon[];
  // How far the server may have moved its lines, in mercator
  tolerance: number;
}

// One cell's copy of an object. Zoom bands tile the same objects at different levels, so while one
// band replaces another both cells hold it.
type HeldObject =
    | {kind: 'line'; key: CellKey; value: Line}
    | {kind: 'point'; key: CellKey; value: Point}
    | {kind: 'polygon'; key: CellKey; value: Polygon};

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

  private readonly fetcher: PoolClient<FetcherInitialize, FetcherRequest, FetcherCommand>;
  private fetching: boolean;
  private readonly loader: PoolClient<LoaderInitialize, LoaderRequest, LoaderResponse>;
  // The request each cell is waiting on, so that a newer one can cancel it before a worker spends
  // time on it and we spend time cloning the answer
  private readonly loading: Map<CellKey, Task<LoaderResponse>>;
  private readonly cells: Map<CellKey, LoadedCell|undefined>;
  // The bytes each cell arrived as, so that a styleZoom change can re-post them to the loader
  // instead of refetching. Same trade MbtileLayer makes with rawBytes.
  private readonly rawBytes: Map<CellKey, {data: ArrayBuffer; tolerance: number}>;
  // Prefixed to the cell keys this layer loads into the shared index
  private readonly producer: string;
  // Every cell's copy of each polygon, newest last, keyed by objectKey, which is also the id the
  // index answers queries with. A cell unloading takes only its own copy, or else the band that
  // replaced it loses objects it still draws and indexes. Lines answer with their cell and index
  // instead, see lineIdPrefix, because there are too many of them to key.
  private readonly objects: Map<string, HeldObject[]>;
  private serial: number;
  // Bumped on every hover and hoverLost, so that an answer for a point the pointer has left is
  // dropped.
  private hoverGeneration: number;
  private lastClick: {id: string; timeMs: number}|undefined;
  private indexed: boolean;
  private generation: number;
  private readonly highlight: Highlight;
  // The object the highlight is drawing. Its geometry is blanked in the cell it was drawn from so
  // that only the highlight draws it, which leaves the highlight free to be narrower or
  // translucent.
  private lastHoverTarget: string|undefined;
  private highlighted: HeldObject|undefined;
  private lastRenderGeneration: number;
  // -1 until the first viewport arrives, so that the first cell to land forces a style pass.
  private styleZoom: number;
  private styleEpoch: number;
  // The zooms where a line style starts or stops, since the loader's output changes only there
  private styleBreaks: number[];
  private rowSchema: Schema|undefined;

  constructor(
      copyrights: Copyright[],
      private readonly url: string,
      // undefined to use the style from the collection's presentation
      style: Style|undefined,
      snaps: Snap[],
      streams: Stream[],
      private readonly locations: LocationIndex,
      private readonly camera: Camera,
      private readonly renderer: Renderer,
  ) {
    super(copyrights);
    this.producer = locations.producer();
    this.fetcher =
        sharedPool<FetcherInitialize, FetcherRequest, FetcherCommand>(
            new URL('s2_data_fetcher_worker.js', import.meta.url).href, /* count= */ 1)
            .connect({covering: url + '/covering', snaps, streams, url: url + '/objects'});
    this.fetching = false;
    this.loader =
        sharedPool<LoaderInitialize, LoaderRequest, LoaderResponse>(
            new URL('collection_loader_worker.js', import.meta.url).href, loaderCount())
            .connect({style: style ?? NO_STYLE});
    this.loading = new Map();
    this.cells = new Map();
    this.rawBytes = new Map();
    this.objects = new Map();
    this.serial = 0;
    this.registerDisposer(() => {
      this.fetcher.dispose();
      this.loader.dispose();
      for (const cell of this.cells.values()) {
        if (cell) {
          this.renderer.deleteBuffer(cell.glGeometryBuffer);
          this.renderer.deleteBuffer(cell.glIndexBuffer);
        }
      }
    });
    this.hoverGeneration = 0;
    this.lastClick = undefined;
    this.indexed = true;
    this.generation = 0;
    this.highlight = {
      drawables: [],
      geometry: new ArrayBuffer(/* length= */ 64 * 1024),
      index: new ArrayBuffer(/* length= */ 64 * 1024),
      glGeometryBuffer: this.renderer.createDataBuffer(/* byteSize= */ 64 * 1024),
      glIndexBuffer: this.renderer.createIndexBuffer(/* byteSize= */ 64 * 1024),
    };
    this.lastHoverTarget = undefined;
    this.highlighted = undefined;
    this.lastRenderGeneration = -1;
    this.styleZoom = -1;
    this.styleEpoch = 0;
    this.styleBreaks = styleBreaks(style ?? NO_STYLE);
    this.rowSchema = undefined;

    this.fetcher.onresponse = command => {
      if (command.kind === 'lcc') {
        this.loadRawCell(command);
      } else if (command.kind === 'ucc') {
        this.unloadCells(command);
      } else if (command.kind === 'usc') {
        this.fetching = command.fetching;
      } else if (command.kind === 'spc') {
        if (command.presentation) {
          const presentation = JSON.parse(command.presentation) as Presentation;
          this.rowSchema = parseSchema(presentation);
          if (!style) {
            this.setStyle(parseStyle(presentation));
          }
        }
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

    this.loader.onfailure = (request, task) => {
      if (request.kind !== 'lr' || this.loading.get(request.key) !== task) {
        return;
      }
      this.loading.delete(request.key);
      // A cell that never drew would otherwise count as loading forever, while one being restyled
      // keeps its old geometry.
      if (this.cells.get(request.key) === undefined) {
        this.cells.delete(request.key);
      }
    };
  }

  /** Returns the schema from the collection's presentation, or undefined until it loads. */
  schema(): Schema|undefined {
    return this.rowSchema;
  }

  /** Redraws and reindexes every held cell with the style, without refetching. */
  setStyle(style: Style): void {
    this.styleEpoch += 1;
    this.styleBreaks = styleBreaks(style);
    this.loader.broadcast({
      kind: 'sr',
      style,
    });
    this.restyle();
  }

  /** Puts this layer's geometry in the shared index or takes it out, for showing and hiding. */
  setIndexed(indexed: boolean): void {
    if (indexed === this.indexed) {
      return;
    }

    this.indexed = indexed;
    for (const [key, cell] of this.cells) {
      if (!cell) {
        continue;
      }

      if (indexed) {
        this.index(key, cell.lines, cell.serial, cell.polygons, cell.tolerance);
      } else {
        this.locations.unload([this.groupKey(key)]);
      }
    }
  }

  // Takes the time before querying, because the query's latency is not the person's.
  override click(point: S2LatLng, px: [number, number], contextual: boolean, source: EventSource): boolean {
    const now = performance.now();
    const clicked = (target: string|undefined, object: HeldObject|undefined) => {
      const last = this.lastClick;
      this.lastClick = target ? {id: target, timeMs: now} : undefined;
      if (object && last && last.id === target && now - last.timeMs < DOUBLE_CLICK_MS) {
        source.trigger(OBJECT_OPENED, {layer: this, object});
      }
    };

    const dot = this.pointAt(point);
    if (dot) {
      clicked(objectKey(dot.value.id), dot);
      // Return true so the line or polygon under the point doesn't also get the click.
      return true;
    }
    this.queryPoint(point).then(ids => {
      const target = ids.find(id => this.resolve(id));
      clicked(target, target ? this.resolve(target) : undefined);
    });
    return false;
  }

  override hover(point: S2LatLng, source: EventSource): boolean {
    this.hoverGeneration += 1;
    const generation = this.hoverGeneration;
    const dot = this.pointAt(point);
    if (dot) {
      this.retarget(objectKey(dot.value.id), dot, source);
      return true;
    }
    this.queryPoint(point).then(ids => {
      if (generation !== this.hoverGeneration) {
        return;
      }

      // A point can land in several nested units, so take the first one we still hold.
      const target = ids.find(id => this.resolve(id));
      this.retarget(target, target ? this.resolve(target) : undefined, source);
    });
    return false;
  }

  // Highlights object. target is its key in the location index.
  private retarget(
      target: string|undefined, object: HeldObject|undefined, source: EventSource): void {
    if (target === this.lastHoverTarget) {
      return;
    }

    this.lastRenderGeneration += 1;
    this.clearHighlight();
    this.lastHoverTarget = target;
    const highlight = this.highlight;

    source.trigger(HOVER_CHANGED, {target: object?.value});
    if (!object) {
      return;
    }

    const cell = this.cells.get(object.key);
    if (!cell) {
      return;
    }
    this.highlighted = object;

    if (object.kind === 'point') {
      const point = object.value;
      const [x, y] = point.position;
      highlight.geometry = growBuffer(highlight.geometry, LineProgram.bytesNeeded(2));
      const result =
          LineProgram.push(
              point.style.fill,
              HOVER_STROKE,
              point.style.radius + HOVER_POINT_PADDING_PX,
              /* stipple= */ false,
              [x, y, x, y],
              highlight.geometry,
              /* offset= */ 0);
      highlight.drawables.push({
        elements: undefined,
        geometry: highlight.glGeometryBuffer,
        geometryByteLength: result.geometryByteLength,
        geometryOffset: 0,
        instanced: {
          count: result.instanceCount,
        },
        program: this.renderer.lineCapProgram,
        texture: undefined,
        vertexCount: result.vertexCount,
        z: Z_USER_DATA_HIGHLIGHT,
      });

      // Hide the existing object
      this.renderer.uploadDataSubset(
        new ArrayBuffer(point.geometryByteLength),
        point.geometryOffset,
        point.geometryByteLength,
        cell.glGeometryBuffer);
    } else if (object.kind === 'line') {
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
        z: Z_USER_DATA_HIGHLIGHT,
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
        z: Z_USER_DATA_HIGHLIGHT - 0.5,
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
          z: Z_USER_DATA_HIGHLIGHT,
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
  }

  override hoverLost(source: EventSource): void {
    // A query in flight would set the highlight back up after we clear it.
    this.hoverGeneration += 1;
    if (!this.lastHoverTarget) {
      return;
    }

    this.lastRenderGeneration += 1;
    this.clearHighlight();
    this.lastHoverTarget = undefined;
    source.trigger(HOVER_CHANGED, {target: undefined});
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
    this.fetcher.broadcast({
      kind: 'uvr',
      viewport: {
        lat: [lat.lo(), lat.hi()],
        lng: [lng.lo(), lng.hi()],
        zoom,
      },
    });

    // Style bands break on integers, so the floor is the only thing a restyle has to watch, and
    // only when it crosses a break.
    const newStyleZoom = Math.floor(zoom);
    if (this.styleZoom < 0
        || styleBand(newStyleZoom, this.styleBreaks)
            !== styleBand(this.styleZoom, this.styleBreaks)) {
      this.styleZoom = newStyleZoom;
      this.restyle();
    }
  }

  private restyle(): void {
    for (const [key, {data, tolerance}] of this.rawBytes) {
      this.load(key, data, tolerance);
    }
  }

  private load(key: CellKey, data: ArrayBuffer, tolerance: number): void {
    this.loading.get(key)?.cancel();
    // No transfer list, so the worker gets a structured clone and this copy survives to restyle.
    this.loading.set(key, this.loader.post({
      kind: 'lr',
      key,
      styleZoom: this.styleZoom,
      styleEpoch: this.styleEpoch,
      tolerance,
      data,
    }));
  }

  private cancel(key: CellKey): void {
    this.loading.get(key)?.cancel();
    this.loading.delete(key);
  }

  // Finds the closest point within HOVER_RADIUS_PX. We search points here because they aren't in the
  // location index, since the router would try to route along anything in it.
  private pointAt(at: S2LatLng): HeldObject|undefined {
    // the layer is hidden, see setIndexed
    if (!this.indexed) {
      return undefined;
    }

    const [x, y] = projectS2LatLng(at);
    // converts pixels to mercator
    const radius = HOVER_RADIUS_PX * this.camera.inverseWorldRadius;
    let best: HeldObject|undefined = undefined;
    let bestDistance2 = radius * radius;
    for (const [key, cell] of this.cells) {
      for (const point of cell?.points ?? []) {
        const dx = point.position[0] - x;
        const dy = point.position[1] - y;
        const distance2 = dx * dx + dy * dy;
        if (distance2 < bestDistance2) {
          best = {kind: 'point', key, value: point};
          bestDistance2 = distance2;
        }
      }
    }
    return best;
  }

  private queryPoint(point: S2LatLng): Promise<string[]> {
    return this.locations.queryPoint(point, HOVER_RADIUS_PX * this.camera.inverseWorldRadius);
  }

  // Two collection layers key their cells the same way, so the prefix keeps their groups apart.
  // Object ids are uuids and need none.
  private groupKey(key: CellKey): string {
    return `${this.producer}${key}`;
  }

  private index(
      key: CellKey, lines: LoadedLines, serial: number, polygons: Polygon[], tolerance: number):
      void {
    if (!this.indexed) {
      return;
    }

    this.locations.load(
        this.groupKey(key),
        tolerance,
        {
          idPrefix: this.lineIdPrefix(key, serial),
          points: lines.points,
          starts: lines.starts,
          terrains: lines.terrains,
          ids: lines.ids,
        },
        polygons.map(polygon => ({
          id: objectKey(polygon.id),
          bound: polygon.bound,
          raw: polygon.raw,
        })),
        /* crossings= */ false,
        // Unsimplified lines need no refining.
        tolerance > 0 ? this.url : undefined);
  }

  private loadRawCell(command: LoadCellCommand): void {
    // It takes 2 bytes to return a response indicating no data
    if (command.data.byteLength <= 2) {
      this.cancel(command.key);
      this.release(command.key);
      this.cells.delete(command.key);
      this.rawBytes.delete(command.key);
      return;
    }

    // A cell we already hold is being refined, so it keeps drawing until the finer geometry lands.
    if (!this.cells.has(command.key)) {
      this.cells.set(command.key, undefined);
    }

    const tolerance = command.snap === undefined ? 0 : SimpleS2.snapEpsilon(command.snap);
    this.rawBytes.set(command.key, {data: command.data, tolerance});
    this.load(command.key, command.data, tolerance);
  }

  private loadProcessedCell(response: LoadResponse): void {
    // Has this already been unloaded?
    if (!this.cells.has(response.key)) {
      return;
    }

    // A restyle at a newer zoom or with a newer style has already gone out, so nobody is looking at
    // this answer.
    if (response.styleZoom !== this.styleZoom || response.styleEpoch !== this.styleEpoch) {
      return;
    }
    this.loading.delete(response.key);

    // Refining a cell throws out the coarser copy of the same objects, and with it the offsets the
    // highlight blanked into its buffer.
    this.release(response.key);

    for (const polygon of response.polygons) {
      this.hold(objectKey(polygon.id), {kind: 'polygon', key: response.key, value: polygon});
    }

    this.serial += 1;
    const serial = this.serial;
    this.index(response.key, response.lines, serial, response.polygons, response.tolerance);

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

    for (const point of response.pointGeometries) {
      drawables.push({
        elements: undefined,
        geometry,
        geometryByteLength: point.geometryByteLength,
        geometryOffset: point.geometryOffset,
        instanced: {
          count: point.instanceCount,
        },
        program: this.renderer.lineCapProgram,
        texture: undefined,
        vertexCount: point.vertexCount,
        z: point.z,
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
      serial,
      points: response.points,
      polygons: response.polygons,
      tolerance: response.tolerance,
    });
    this.generation += 1;
  }

  private unloadCells(command: UnloadCellsCommand): void {
    for (const key of command.keys) {
      this.cancel(key);
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

    for (const polygon of cell.polygons) {
      this.drop(objectKey(polygon.id), key);
    }
    this.locations.unload([this.groupKey(key)]);

    this.renderer.deleteBuffer(cell.glGeometryBuffer);
    this.renderer.deleteBuffer(cell.glIndexBuffer);

    // The highlight blanked geometry in a buffer that is now gone, so there is nothing to put back.
    if (this.highlighted?.key === key) {
      this.dropHighlight();
    }
  }

  // What the index puts ahead of a line's position in a cell's load to make the id it answers with
  private lineIdPrefix(key: CellKey, serial: number): string {
    return `${this.groupKey(key)}#${serial}#`;
  }

  // The object an id from the index names, if we still hold it
  private resolve(id: string): HeldObject|undefined {
    if (!id.startsWith(this.producer)) {
      return this.held(id);
    }

    const indexAt = id.lastIndexOf('#');
    const serialAt = id.lastIndexOf('#', indexAt - 1);
    const key = id.substring(this.producer.length, serialAt) as CellKey;
    const cell = this.cells.get(key);
    if (!cell || cell.serial !== Number(id.substring(serialAt + 1, indexAt))) {
      return undefined;
    }
    return {kind: 'line', key, value: lineAt(cell.lines, Number(id.substring(indexAt + 1)))};
  }

  // The newest copy, which belongs to the band the viewport is moving into
  private held(id: string): HeldObject|undefined {
    const copies = this.objects.get(id);
    return copies?.[copies.length - 1];
  }

  private hold(id: string, object: HeldObject): void {
    const copies = (this.objects.get(id) ?? []).filter(c => c.key !== object.key);
    copies.push(object);
    this.objects.set(id, copies);
  }

  private drop(id: string, key: CellKey): void {
    const copies = this.objects.get(id)?.filter(c => c.key !== key) ?? [];
    if (copies.length > 0) {
      this.objects.set(id, copies);
    } else {
      this.objects.delete(id);
    }
  }

  // Puts back the geometry the highlight hid, then stops drawing it.
  private clearHighlight(): void {
    const object = this.highlighted;
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
      } else if (object.kind === 'point') {
        const point = object.value;
        const [x, y] = point.position;
        const restored = new ArrayBuffer(point.geometryByteLength);
        LineProgram.push(
            point.style.fill,
            point.style.stroke,
            point.style.radius,
            /* stipple= */ false,
            [x, y, x, y],
            restored,
            /* offset= */ 0);
        this.renderer.uploadDataSubset(
          restored, point.geometryOffset, point.geometryByteLength, cell.glGeometryBuffer);
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
    this.highlighted = undefined;
  }
}

// The JSON in collections.presentation, see 7_collection_presentation.toml. lines, points, and
// polygons are a Style with #RRGGBBAA colors and without z, which the client picks. The rest is a
// Schema with a plain text title.
interface Presentation {
  title?: string;
  description?: string;
  fields?: Array<{key: string; label: string; values?: {[raw: string]: string}}>;
  lines?: Array<{
    filters: Match[];
    fill: string;
    stroke: string;
    radius: number;
    minZoom?: number;
    maxZoom?: number;
    stipple?: Stipple;
  }>;
  points?: Array<{filters: Match[]; fill: string; stroke: string; radius: number}>;
  polygons?: Array<{filters: Match[]; fill: string}>;
}

// Converts a presentation into a Style, filling in what the client decides like z.
function parseStyle(presentation: Presentation): Style {
  return {
    lines: (presentation.lines ?? []).map(line => ({
      filters: line.filters,
      minZoom: line.minZoom ?? 0,
      maxZoom: line.maxZoom ?? Infinity,
      fill: parseColor(line.fill),
      stroke: parseColor(line.stroke),
      radius: line.radius,
      stipple: line.stipple ?? false,
      z: Z_USER_DATA,
    })),
    points: (presentation.points ?? []).map(point => ({
      filters: point.filters,
      fill: parseColor(point.fill),
      stroke: parseColor(point.stroke),
      radius: point.radius,
      z: Z_USER_DATA,
    })),
    polygons: (presentation.polygons ?? []).map(polygon => ({
      filters: polygon.filters,
      fill: parseColor(polygon.fill),
      z: Z_USER_DATA,
    })),
  };
}

function parseSchema(presentation: Presentation): Schema|undefined {
  if (!presentation.title) {
    return undefined;
  }
  return {
    title: {kind: 'text', key: presentation.title},
    description: presentation.description,
    fields: presentation.fields ?? [],
  };
}

function parseColor(hex: string): RgbaU32 {
  if (!/^#[0-9a-fA-F]{8}$/.test(hex)) {
    throw new Error(`Expected #RRGGBBAA, got ${hex}`);
  }
  return parseInt(hex.substring(1), 16) as RgbaU32;
}

// The id an object goes into the index under, and the key objects holds it by.
function objectKey(id: RawUuid): string {
  return `${id.msb}-${id.lsb}`;
}

function raiseAlpha(color: RgbaU32, alpha: number): RgbaU32 {
  return (((color & 0xFFFFFF00) >>> 0) | alpha) as RgbaU32;
}

// One line of a cell as a Line, for the few objects a hover or click lands on
function lineAt(lines: LoadedLines, i: number): Line {
  const data =
      lines.data.kind === 'packed_path'
          ? {id: lines.data.ids[i], type: lines.data.types[i]}
          : lines.data.values[i];
  return {
    id: {lsb: lines.ids[2 * i + 0], msb: lines.ids[2 * i + 1]},
    data,
    geometryByteLength: lines.geometryByteLengths[i],
    geometryOffset: lines.geometryOffsets[i],
    points: lines.points.subarray(lines.starts[i], lines.starts[i + 1]),
    style: lines.styles[lines.styleIndices[i]],
  };
}

function styleBreaks(style: Style): number[] {
  const breaks = new Set<number>();
  for (const line of style.lines) {
    breaks.add(line.minZoom);
    breaks.add(line.maxZoom);
  }
  return [...breaks];
}

// Which run between breaks a zoom sits in, since the loader styles every zoom in one alike
function styleBand(zoom: number, breaks: number[]): number {
  let band = 0;
  for (const b of breaks) {
    if (b <= zoom) {
      band += 1;
    }
  }
  return band;
}
