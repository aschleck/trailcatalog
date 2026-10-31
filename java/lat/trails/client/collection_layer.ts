import { OBJECTS_WIRE_VERSION } from 'java/lat/trails/wire/wire';
import { unpackPathTraits } from 'java/org/trailcatalog/models/categories';
import { S2LatLng, S2LatLngRect, SimpleS2 } from 'java/org/trailcatalog/s2';
import { checkExhaustive } from 'external/dev_april_corgi+/js/common/asserts';
import { Task } from 'external/dev_april_corgi+/js/common/queued_worker_pool';
import { Camera, projectS2LatLng } from 'js/map/camera';
import { Copyright, RawUuid, RgbaU32 } from 'js/map/common/types';
import { EventSource, Layer } from 'js/map/layer';
import { growBuffer } from 'js/map/rendering/buffers';
import { LinePattern, LineProgram } from 'js/map/rendering/line_program';
import { Planner } from 'js/map/rendering/planner';
import { Drawable } from 'js/map/rendering/program';
import { Renderer } from 'js/map/rendering/renderer';
import { loaderCount, PoolClient, sharedPool } from 'js/map/workers/client_pool';
import { LocationIndex } from 'js/map/workers/location_index';
import { Command as FetcherCommand, Initialize as FetcherInitialize, LoadCellCommand, Request as FetcherRequest, Snap, UnloadCellsCommand } from 'js/map/workers/s2_data_fetcher';
import { CellKey, getStream, isInBand, Stream } from 'js/map/workers/s2_streams';
import { Z_USER_DATA_HIGHLIGHT } from 'js/map/z';

import { SELECTED_CASING } from './feature_layer';
import { parseCollectionSchema } from './schema';
import { Initialize as LoaderInitialize, Line, LoadedLines, LoadResponse, Point, Request as LoaderRequest, Response as LoaderResponse, Polygon, Style, Styling } from './workers/collection_loader';
import { CollectionSchema } from './workers/collection_schema';

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

// The object the inspector shows draws again on top, wider and in a white casing, like a selected
// feature.
const SELECTED_PADDING_PX = 2;
// Under the hover highlight, so hovering the selected object still lifts it
const Z_SELECTED = Z_USER_DATA_HIGHLIGHT - 0.25;

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

// An object and the cell that draws it
export type HeldObject =
    | {kind: 'line'; key: CellKey; value: Line}
    | {kind: 'point'; key: CellKey; value: Point}
    | {kind: 'polygon'; key: CellKey; value: Polygon};

interface Run {
  fill: RgbaU32;
  stroke: RgbaU32;
  radius: number;
  pattern: LinePattern;
  points: ArrayLike<number>;
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

  private readonly fetcher: PoolClient<FetcherInitialize, FetcherRequest, FetcherCommand>;
  private fetching: boolean;
  private readonly loader: PoolClient<LoaderInitialize, LoaderRequest, LoaderResponse>;
  // The request each cell is waiting on, so that a newer one can cancel it before a worker spends
  // time on it and we spend time cloning the answer
  private readonly loading: Map<CellKey, Task<LoaderResponse>>;
  private readonly cells: Map<CellKey, LoadedCell|undefined>;
  // The zoom the fetcher was last sent
  private zoom: number;
  // Zoom bands tile the same objects at different levels, so only cells whose stream is in band at
  // shownZoom draw and index, or else two bands draw the same object. It trails zoom so the old
  // band keeps drawing until the new one has loaded. See settle.
  private shownZoom: number;
  // Cells the fetcher dropped whose band is being replaced, kept drawing until the new band loads
  private readonly retiring: Set<CellKey>;
  // The bytes each cell arrived as, so that a styleZoom change can re-post them to the loader
  // instead of refetching. Same trade MbtileLayer makes with rawBytes.
  private readonly rawBytes: Map<CellKey, {data: ArrayBuffer; tolerance: number}>;
  // Prefixed to the cell keys this layer loads into the shared index
  private readonly producer: string;
  // The polygons of drawn cells keyed by objectKey, which is also the id the index answers queries
  // with. Lines answer with their cell and index instead, see lineIdPrefix, because there are too
  // many of them to key.
  private readonly objects: Map<string, HeldObject>;
  private serial: number;
  // Bumped on every hover and hoverLost, so that an answer for a point the pointer has left is
  // dropped.
  private hoverGeneration: number;
  private indexed: boolean;
  private readonly highlight: Highlight;
  // The object the highlight is drawing. Its geometry is blanked in the cell it was drawn from so
  // that only the highlight draws it, which leaves the highlight free to be narrower or
  // translucent.
  private lastHoverTarget: string|undefined;
  private highlighted: HeldObject|undefined;
  // Drawn above its cell rather than in place of it, so a cell reloading under it leaves it alone
  private readonly selection: {buffer: ArrayBuffer; drawables: Drawable[]; glBuffer: WebGLBuffer};
  // -1 until the first viewport arrives, so that the first cell to land forces a style pass.
  private styleZoom: number;
  // The zooms where a line style starts or stops, since the loader's output changes only there
  private styleBreaks: number[];
  private collectionSchema: CollectionSchema|undefined;

  constructor(
      copyrights: Copyright[],
      private readonly url: string,
      // undefined to use the style from the collection's schema
      style: Style|undefined,
      snaps: Snap[],
      private readonly streams: Stream[],
      private readonly locations: LocationIndex,
      private readonly camera: Camera,
      private readonly renderer: Renderer,
  ) {
    super(copyrights);
    this.producer = locations.producer();
    this.fetcher =
        sharedPool<FetcherInitialize, FetcherRequest, FetcherCommand>(
            new URL('s2_data_fetcher_worker.js', import.meta.url).href, /* count= */ 1)
            .connect({
              covering: url + '/covering',
              snaps,
              streams,
              url: url + '/objects',
              wireVersion: OBJECTS_WIRE_VERSION,
            });
    this.fetching = false;
    const initial: Styling = {kind: 'rules', style: style ?? NO_STYLE};
    this.loader =
        sharedPool<LoaderInitialize, LoaderRequest, LoaderResponse>(
            new URL('collection_loader_worker.js', import.meta.url).href, loaderCount())
            .connect({styling: initial});
    this.loading = new Map();
    this.cells = new Map();
    this.zoom = -1;
    this.shownZoom = -1;
    this.retiring = new Set();
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
      this.renderer.deleteBuffer(this.highlight.glGeometryBuffer);
      this.renderer.deleteBuffer(this.highlight.glIndexBuffer);
    });
    this.hoverGeneration = 0;
    this.indexed = true;
    this.highlight = {
      drawables: [],
      geometry: new ArrayBuffer(/* length= */ 64 * 1024),
      index: new ArrayBuffer(/* length= */ 64 * 1024),
      glGeometryBuffer: this.renderer.createDataBuffer(/* byteSize= */ 64 * 1024),
      glIndexBuffer: this.renderer.createIndexBuffer(/* byteSize= */ 64 * 1024),
    };
    this.lastHoverTarget = undefined;
    this.highlighted = undefined;
    // A couple thousand vertices
    this.selection = {
      buffer: new ArrayBuffer(64 * 1024),
      drawables: [],
      glBuffer: this.renderer.createDataBuffer(64 * 1024),
    };
    this.registerDisposer(() => {
      this.renderer.deleteBuffer(this.selection.glBuffer);
    });
    this.styleZoom = -1;
    this.styleBreaks = styleBreaks(initial);
    this.collectionSchema = undefined;

    this.fetcher.onresponse = command => {
      if (command.kind === 'lcc') {
        this.loadRawCell(command);
      } else if (command.kind === 'ucc') {
        this.unloadCells(command);
      } else if (command.kind === 'usc') {
        this.fetching = command.fetching;
        this.settle();
      } else if (command.kind === 'ssc') {
        if (command.schema) {
          const schema = parseCollectionSchema(command.schema);
          this.collectionSchema = schema;
          if (!style) {
            this.restyleWith({kind: 'schema', schema});
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
        this.unload(request.key);
      }
      this.settle();
    };
  }

  getCollectionSchema(): CollectionSchema|undefined {
    return this.collectionSchema;
  }

  /** Redraws and reindexes every held cell with the style, without refetching. */
  setStyle(style: Style): void {
    this.restyleWith({kind: 'rules', style});
  }

  /** Puts this layer's geometry in the shared index or takes it out, for showing and hiding. */
  setIndexed(indexed: boolean): void {
    if (indexed === this.indexed) {
      return;
    }

    this.indexed = indexed;
    for (const [key, cell] of this.getShownCells()) {
      if (indexed) {
        this.index(key, cell);
      } else {
        this.locations.unload([this.groupKey(key)]);
      }
    }
  }

  /** Returns the objects under the point: points, then lines nearest first, then polygons. */
  async objectsAt(point: S2LatLng): Promise<HeldObject[]> {
    const dots = this.pointsAt(point);
    const ids = await this.queryPoint(point);
    return [...dots, ...ids.flatMap(id => this.resolve(id) ?? [])];
  }

  /** Highlights the object as if the pointer were over it, or clears the highlight. */
  highlightObject(object: HeldObject|undefined): void {
    // A hover query in flight would otherwise replace it.
    this.hoverGeneration += 1;
    this.retarget(object && objectKey(object.value.id), object);
  }

  /** Draws the object as selected, or stops drawing a selection. */
  selectObject(object: HeldObject|undefined): void {
    const runs: Array<Omit<Run, 'stroke'>> = [];
    if (object?.kind === 'polygon') {
      const {outline, style} = object.value;
      const fill = style.outline?.fill ?? raiseAlpha(style.fill, 0xFF);
      const radius = style.outline?.radius ?? HOVER_POLYGON_OUTLINE_RADIUS_PX;
      for (const ring of outline) {
        runs.push({fill, radius, pattern: 'solid', points: ring});
      }
    } else if (object) {
      runs.push(getRun(object));
    }

    const selection = this.selection;
    let needed = 0;
    for (const run of runs) {
      needed += LineProgram.bytesNeeded(run.points.length / 2);
    }
    selection.buffer = growBuffer(selection.buffer, needed);
    // Every run is the same program, so like a polygon's hovered outline they draw as one.
    let offset = 0;
    let instances = 0;
    let vertexCount = 0;
    for (const run of runs) {
      const result =
          LineProgram.push(
              run.fill,
              SELECTED_CASING,
              run.radius + SELECTED_PADDING_PX,
              run.pattern,
              run.points,
              selection.buffer,
              offset);
      offset += result.geometryByteLength;
      instances += result.instanceCount;
      vertexCount = result.vertexCount;
    }
    selection.drawables = [];
    if (instances > 0) {
      this.renderer.uploadData(selection.buffer, offset, selection.glBuffer);
      selection.drawables.push({
        elements: undefined,
        geometry: selection.glBuffer,
        geometryByteLength: offset,
        geometryOffset: 0,
        instanced: {
          count: instances,
        },
        program: this.renderer.lineProgram,
        texture: undefined,
        vertexCount,
        z: Z_SELECTED,
      });
    }
    this.redraw();
  }

  override hover(point: S2LatLng, source: EventSource): boolean {
    this.hoverGeneration += 1;
    const generation = this.hoverGeneration;
    const dot = this.pointsAt(point)[0];
    if (dot) {
      this.retarget(objectKey(dot.value.id), dot);
      return true;
    }
    this.queryPoint(point).then(ids => {
      if (generation !== this.hoverGeneration) {
        return;
      }

      // A point can land in several nested units, so take the first one we still hold.
      const target = ids.find(id => this.resolve(id));
      this.retarget(target, target ? this.resolve(target) : undefined);
    });
    return false;
  }

  // Highlights object. target is its key in the location index.
  private retarget(target: string|undefined, object: HeldObject|undefined): void {
    if (target === this.lastHoverTarget) {
      return;
    }

    this.redraw();
    this.clearHighlight();
    this.lastHoverTarget = target;
    const highlight = this.highlight;
    if (!object) {
      return;
    }

    const cell = this.cells.get(object.key);
    if (!cell) {
      return;
    }
    this.highlighted = object;

    if (object.kind !== 'polygon') {
      const run = getRun(object);
      highlight.geometry =
          growBuffer(highlight.geometry, LineProgram.bytesNeeded(run.points.length / 2));
      highlight.drawables.push(
          this.renderer.lineProgram.plan(
              object.kind === 'point' ? run.fill : HOVER_FILL,
              HOVER_STROKE,
              object.kind === 'point'
                  ? run.radius + HOVER_POINT_PADDING_PX
                  : Math.max(run.radius + HOVER_LINE_PADDING_PX, HOVER_LINE_MIN_RADIUS_PX),
              /* pattern= */ 'solid',
              Z_USER_DATA_HIGHLIGHT,
              run.points,
              highlight.geometry,
              /* offset= */ 0,
              highlight.glGeometryBuffer));
    } else {
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
                /* pattern= */ 'solid',
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
      }

      this.renderer.uploadIndices(
        highlight.index, highlight.index.byteLength, highlight.glIndexBuffer);
    }

    // Hide the existing object
    const {geometryByteLength, geometryOffset} = object.value;
    this.renderer.uploadDataSubset(
      new ArrayBuffer(geometryByteLength),
      geometryOffset,
      geometryByteLength,
      cell.glGeometryBuffer);
    this.renderer.uploadData(
      highlight.geometry, highlight.geometry.byteLength, highlight.glGeometryBuffer);
  }

  override hoverLost(source: EventSource): void {
    this.highlightObject(undefined);
  }

  override loadingData(): boolean {
    return this.isPending() || [...this.cells.keys()].some(key => !this.isShown(key));
  }

  override render(planner: Planner): void {
    for (const [, cell] of this.getShownCells()) {
      planner.add(cell.drawables);
    }

    planner.add(this.selection.drawables);
    planner.add(this.highlight.drawables);
  }

  override viewportChanged(bounds: S2LatLngRect, zoom: number, fetchZoom: number): void {
    this.loader.start();
    this.zoom = zoom;
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

  private restyleWith(styling: Styling): void {
    this.styleBreaks = styleBreaks(styling);
    this.loader.broadcast({kind: 'sr', styling});
    this.restyle();
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
      tolerance,
      data,
    }));
  }

  private cancel(key: CellKey): void {
    this.loading.get(key)?.cancel();
    this.loading.delete(key);
  }

  // Finds the points within HOVER_RADIUS_PX, closest first. We search points here because they
  // aren't in the location index, since the router would try to route along anything in it.
  private pointsAt(at: S2LatLng): HeldObject[] {
    // the layer is hidden, see setIndexed
    if (!this.indexed) {
      return [];
    }

    const [x, y] = projectS2LatLng(at);
    // converts pixels to mercator
    const radius = HOVER_RADIUS_PX * this.camera.inverseWorldRadius;
    const found: Array<{object: HeldObject; distance2: number}> = [];
    for (const [key, cell] of this.getShownCells()) {
      for (const point of cell.points) {
        const dx = point.position[0] - x;
        const dy = point.position[1] - y;
        const distance2 = dx * dx + dy * dy;
        if (distance2 < radius * radius) {
          found.push({object: {kind: 'point', key, value: point}, distance2});
        }
      }
    }
    found.sort((a, b) => a.distance2 - b.distance2);
    return found.map(({object}) => object);
  }

  private queryPoint(point: S2LatLng): Promise<string[]> {
    return this.locations.queryPoint(point, HOVER_RADIUS_PX * this.camera.inverseWorldRadius);
  }

  // Two collection layers key their cells the same way, so the prefix keeps their groups apart.
  // Object ids are uuids and need none.
  private groupKey(key: CellKey): string {
    return `${this.producer}${key}`;
  }

  private index(key: CellKey, {lines, serial, polygons, tolerance}: LoadedCell): void {
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
      this.unload(command.key);
      this.settle();
      return;
    }

    this.retiring.delete(command.key);

    // A cell we already hold is being refined, so it keeps drawing until the finer geometry lands.
    if (!this.cells.has(command.key)) {
      this.cells.set(command.key, undefined);
      this.redraw();
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

    this.loading.delete(response.key);

    // Refining a cell throws out the coarser copy of the same objects, and with it the offsets the
    // highlight blanked into its buffer.
    this.release(response.key);

    this.serial += 1;
    const serial = this.serial;

    const geometry = this.renderer.createDataBuffer(response.geometry.byteLength);
    const index = this.renderer.createIndexBuffer(response.index.byteLength);
    this.renderer.uploadData(response.geometry, response.geometry.byteLength, geometry);
    this.renderer.uploadIndices(response.index, response.index.byteLength, index);
    const drawables = [];

    for (const line of response.lineGeometries) {
      const drawable = {
        bounds: line.bounds,
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
      };
      drawables.push(drawable);
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

    const cell = {
      glGeometryBuffer: geometry,
      glIndexBuffer: index,
      drawables,
      lines: response.lines,
      serial,
      points: response.points,
      polygons: response.polygons,
      tolerance: response.tolerance,
    };
    this.cells.set(response.key, cell);
    if (this.isShown(response.key)) {
      this.show(response.key, cell);
    }
    this.settle();
  }

  private unloadCells(command: UnloadCellsCommand): void {
    // Cells that only left the viewport go right away instead of piling up while a long pan keeps
    // the fetcher busy.
    for (const key of command.keys) {
      if (this.cells.get(key) && this.isLeaving(key)) {
        this.retiring.add(key);
      } else {
        this.unload(key);
      }
    }
    this.settle();
  }

  // Drops the retiring cells once nothing is loading, then moves shownZoom up to zoom if no drawn
  // cell is left from the old band.
  private settle(): void {
    if (!this.isPending()) {
      for (const key of this.retiring) {
        this.unload(key);
      }
    }

    if (![...this.cells.keys()].some(key => this.isLeaving(key))) {
      const was = this.shownZoom;
      this.shownZoom = this.zoom;
      for (const [key, cell] of this.getShownCells()) {
        if (!this.isInBandAt(key, was)) {
          this.show(key, cell);
        }
      }
    }
    this.redraw();
  }

  private show(key: CellKey, cell: LoadedCell): void {
    for (const polygon of cell.polygons) {
      this.objects.set(objectKey(polygon.id), {kind: 'polygon', key, value: polygon});
    }
    this.index(key, cell);
  }

  private unload(key: CellKey): void {
    this.cancel(key);
    this.release(key);
    this.cells.delete(key);
    this.rawBytes.delete(key);
    this.retiring.delete(key);
  }

  private isShown(key: CellKey): boolean {
    return this.isInBandAt(key, this.shownZoom);
  }

  // Drawn, but the fetcher has moved on to a band that replaces it
  private isLeaving(key: CellKey): boolean {
    return this.isShown(key) && !this.isInBandAt(key, this.zoom);
  }

  private isInBandAt(key: CellKey, zoom: number): boolean {
    return isInBand(this.streams[getStream(key)], zoom);
  }

  private *getShownCells(): Iterable<[CellKey, LoadedCell]> {
    for (const [key, cell] of this.cells) {
      if (cell && this.isShown(key)) {
        yield [key, cell];
      }
    }
  }

  private isPending(): boolean {
    return this.fetching || [...this.cells.values()].some(cell => !cell);
  }

  // Throws out everything a cell owns, either because it left the viewport or because finer
  // geometry is about to replace it. The caller decides what the cell becomes.
  private release(key: CellKey): void {
    const cell = this.cells.get(key);
    if (!cell) {
      return;
    }

    for (const polygon of cell.polygons) {
      if (this.objects.get(objectKey(polygon.id))?.key === key) {
        this.objects.delete(objectKey(polygon.id));
      }
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
      return this.objects.get(id);
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

  // Puts back the geometry the highlight hid, then stops drawing it.
  private clearHighlight(): void {
    const object = this.highlighted;
    const cell = object ? this.cells.get(object.key) : undefined;
    if (object && cell) {
      const {geometryByteLength, geometryOffset} = object.value;
      if (object.kind === 'polygon') {
        this.renderer.uploadDataSubset(
          Float32Array.from(object.value.triangles.geometry).buffer,
          geometryOffset,
          geometryByteLength,
          cell.glGeometryBuffer);
      } else {
        const {fill, stroke, radius, pattern, points} = getRun(object);
        const restored = new ArrayBuffer(geometryByteLength);
        LineProgram.push(fill, stroke, radius, pattern, points, restored, /* offset= */ 0);
        this.renderer.uploadDataSubset(
          restored, geometryOffset, geometryByteLength, cell.glGeometryBuffer);
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

// The id an object goes into the index under, and the key objects holds it by.
function objectKey(id: RawUuid): string {
  return `${id.msb}-${id.lsb}`;
}

// A point draws as a zero length line, so lines and points both draw as a LineProgram run
function getRun(object: Exclude<HeldObject, {kind: 'polygon'}>): Run {
  if (object.kind === 'line') {
    const {points, style: {fill, stroke, radius, pattern}} = object.value;
    return {fill, stroke, radius, pattern, points};
  }
  const {position: [x, y], style: {fill, stroke, radius}} = object.value;
  return {fill, stroke, radius, pattern: 'solid', points: [x, y, x, y]};
}

function raiseAlpha(color: RgbaU32, alpha: number): RgbaU32 {
  return (((color & 0xFFFFFF00) >>> 0) | alpha) as RgbaU32;
}

// One line of a cell as a Line, for the few objects a hover or click lands on
function lineAt(lines: LoadedLines, i: number): Line {
  let data;
  if (lines.data.kind === 'packed_path') {
    data = {id: lines.data.ids[i], type: lines.data.types[i]};
    unpackPathTraits(lines.data.traits[i], data);
  } else {
    data = lines.data.values[i];
  }
  return {
    id: {lsb: lines.ids[2 * i + 0], msb: lines.ids[2 * i + 1]},
    data,
    geometryByteLength: lines.geometryByteLengths[i],
    geometryOffset: lines.geometryOffsets[i],
    points: lines.points.subarray(lines.starts[i], lines.starts[i + 1]),
    style: lines.styles[lines.styleIndices[i]],
  };
}

// The zooms where the styling changes, which a schema's never does
function styleBreaks(styling: Styling): number[] {
  if (styling.kind === 'schema') {
    return [];
  }
  const breaks = new Set<number>();
  for (const line of styling.style.lines) {
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
