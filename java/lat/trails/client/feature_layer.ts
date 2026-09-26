import { S2LatLng, S2LatLngRect } from 'java/org/trailcatalog/s2';
import { SimpleS2 } from 'java/org/trailcatalog/s2/SimpleS2';
import { Camera, projectE7Array, projectLatLngRect, projectS2LatLng } from 'js/map/camera';
import { RgbaU32, Vec2 } from 'js/map/common/types';
import { EventSource, Layer } from 'js/map/layer';
import { growBuffer } from 'js/map/rendering/buffers';
import { GLYPHER, toGraphemes } from 'js/map/rendering/glypher';
import { LineProgram } from 'js/map/rendering/line_program';
import { Planner } from 'js/map/rendering/planner';
import { Drawable } from 'js/map/rendering/program';
import { Renderer } from 'js/map/rendering/renderer';
import { LocationIndex } from 'js/map/workers/location_index';
import { Z_USER_DATA, Z_USER_DATA_HIGHLIGHT } from 'js/map/z';

import { FeatureStore } from './feature_store';
import { FEATURE_CLICKED, FEATURE_EDITED, FEATURE_HOVERED } from './events';
import {
  DEFAULT_LINE_COLOR,
  DEFAULT_POINT_COLOR,
  DEFAULT_WIDTH_PX,
  EditableFeature,
  EditableLine,
  EditablePoint,
  snapshot,
} from './features';
import {
  createHandleTexture,
  Handle,
  HANDLE_SIZE_PX,
  handleBytesNeeded,
  INSERT_HANDLE_SIZE_PX,
  planHandles,
} from './handles';
import { insertVertex, moveVertex, removeVertex } from './line_edits';

const POINT_RADIUS_PX = 5;
const SELECTED_POINT_RADIUS_PX = 7;
// How far past a feature's drawn edge a click still lands on it
const CLICK_SLOP_PX = 3;
// The casing LineProgram draws is a pixel wide on each side, see line_cap_program.ts.
const CASING_PX = 1;
const SELECTED_CASING = 0xFFFFFFFF as RgbaU32;
const HOVERED_CASING = 0xFFFFFF99 as RgbaU32;
const POINT_CASING = 0xFFFFFFFF as RgbaU32;
const LABEL_FILL = 0x1A1A1AFF as RgbaU32;
const LABEL_STROKE = 0xFFFFFFFF as RgbaU32;
// FONT_SIZE is 28, so labels are 14px.
const LABEL_SCALE = 0.5;
const LABEL_OFFSET_PX = [POINT_RADIUS_PX + 4, 0] as Vec2;
// Tracks recorded by GPS wiggle every few meters, and Glypher refuses to bend text around turns
// that sharp, so a label follows the line simplified to about this many pixels.
const LABEL_PATH_TOLERANCE_PX = 4;
// Where along a line to try starting its label, as fractions of its length, best first
const LABEL_ANCHORS = [0.5, 0.3, 0.7, 0.15, 0.85];


// A GPS track has a vertex every few meters, which at most zooms is several per pixel, so a vertex
// only gets a handle once it is this far from the last one that did.
const HANDLE_SPACING_PX = 12;
// Two clicks on one line this close together count as a double click.
const DOUBLE_CLICK_MS = 400;

const Z_LINE = Z_USER_DATA;
const Z_SELECTED_LINE = Z_USER_DATA_HIGHLIGHT;
const Z_POINT = Z_USER_DATA_HIGHLIGHT + 1;
const Z_LABEL = Z_USER_DATA_HIGHLIGHT + 2;
const Z_DRAGGED = Z_USER_DATA_HIGHLIGHT + 3;
const Z_HANDLE = Z_USER_DATA_HIGHLIGHT + 4;

// How far a line may sit from where it was drawn, which is only the rounding to E7. That moves
// each axis by up to half a unit, and mercator stretches latitude by sec(lat), so this covers
// drawing up to 83 degrees north or south, where sec reaches 8:
// => hypot(0.5, 0.5 * 8) = 4.03 E7 units
// => 4.03e-7 degrees, over 180 degrees to the mercator unit
const DRAWN_TOLERANCE = 4.03e-7 / 180;

interface ProjectedLine {
  feature: EditableLine;
  // The array these points came from, so that reprojecting can be skipped when it is unchanged
  latLngE7: Int32Array;
  points: Float64Array;
  // The line simplified for its label at an integer zoom, and the vertices to try starting it at
  label: {zoom: number; points: Float64Array; anchors: number[]}|undefined;
}

interface ProjectedPoint {
  feature: EditablePoint;
  at: Vec2;
}

// What the pointer is moving. Line drags work on a mercator copy of the line with the vertex
// moved, or inserted where the insert marker was, which becomes the edit when the drag ends.
type Drag =
    {kind: 'point'; point: EditablePoint; at: Vec2}
    |{kind: 'vertex'|'insert'; line: ProjectedLine; index: number; points: Float64Array};

// Geometry in one buffer and the drawables that read it, replanned when generation moves past
// planned.
interface Plan {
  buffer: ArrayBuffer;
  glBuffer: WebGLBuffer;
  drawables: Drawable[];
  generation: number;
  planned: number;
}

/** Draws the open collection's features. */
export class FeatureLayer extends Layer {

  // Prefixed to everything this layer puts in the shared index
  private readonly producer: string;
  private hidden: ReadonlySet<string>;
  private selected: string|undefined;
  // The feature under the pointer, on the map or in the list
  private hovered: string|undefined;
  // Every line, visible or not, so that a folder toggling does not reproject its lines
  private readonly projected: Map<string, ProjectedLine>;
  private visibleLines: ProjectedLine[];
  private visiblePoints: ProjectedPoint[];
  // What is in the index, by line id, as the latLngE7 array it was built from
  private readonly published: Map<string, Int32Array>;
  // Every feature but the one being dragged
  private readonly geometry: Plan;
  // The dragged feature and the handles of the line being edited, which change on every pointer
  // move and would otherwise replan every line each time
  private readonly overlay: Plan;
  private readonly glLabels: WebGLBuffer;
  private readonly handleTexture: WebGLTexture;
  private labels: ArrayBuffer;
  private labelDrawables: Drawable[];
  private labelsPlanned: {generation: number; zoom: number};
  // Only the pointer tool selects, drags, and edits, or else a drawing tool's clicks would also
  // grab whatever is under them.
  private interactive: boolean;
  // The line showing its vertex handles, entered by double clicking it
  private editing: string|undefined;
  // The handle a click picked, which Delete removes
  private activeVertex: number|undefined;
  // Where on the edited line the pointer is, and the index a vertex dragged from there takes
  private inserting: {index: number; at: Vec2}|undefined;
  // The vertices of the edited line that have handles, as of the last overlay plan
  private handles: number[];
  private dragging: Drag|undefined;
  private lastClick: {id: string; timeMs: number}|undefined;
  // In mercator, for culling handles to what is on screen
  private viewport: {low: Vec2; high: Vec2};
  // Glypher builds its atlas asynchronously and plans nothing for a grapheme it lacks, so labels
  // planned before the atlas holds them have to be planned again once it does.
  private labelsMissingGlyphs: boolean;

  constructor(
      private readonly store: FeatureStore,
      // Where lines go so that drawing snaps and routes along them
      private readonly locations: LocationIndex,
      private readonly camera: Camera,
      private readonly renderer: Renderer,
  ) {
    super(/* copyright= */ []);
    this.producer = locations.producer();
    this.hidden = new Set();
    this.selected = undefined;
    this.hovered = undefined;
    this.projected = new Map();
    this.visibleLines = [];
    this.visiblePoints = [];
    this.published = new Map();
    // An imported day hike is about 100 kb of geometry.
    this.geometry = this.createPlan(128 * 1024);
    // A few hundred handles
    this.overlay = this.createPlan(16 * 1024);
    this.glLabels = renderer.createDataBuffer(16 * 1024);
    this.handleTexture = createHandleTexture(renderer);
    this.labels = new ArrayBuffer(16 * 1024);
    this.labelDrawables = [];
    this.labelsPlanned = {generation: -1, zoom: -1};
    this.labelsMissingGlyphs = false;
    this.interactive = true;
    this.editing = undefined;
    this.activeVertex = undefined;
    this.inserting = undefined;
    this.handles = [];
    this.dragging = undefined;
    this.lastClick = undefined;
    this.viewport = {low: [-1, -1], high: [1, 1]};
    this.registerDisposer(() => {
      renderer.deleteBuffer(this.glLabels);
      renderer.deleteTexture(this.handleTexture);
      this.locations.unload([...this.published.keys()].map(id => this.key(id)));
    });

    store.listen(() => {
      this.refresh();
    });
  }

  /** Hides the features with these ids, and everything inside the folders among them. */
  setHidden(hidden: ReadonlySet<string>): void {
    this.hidden = hidden;
    this.refresh();
  }

  setSelected(id: string|undefined): void {
    if (id === this.selected) {
      return;
    }

    this.selected = id;
    if (id !== this.editing) {
      this.stopEditing();
    }
    this.geometry.generation += 1;
  }

  setHovered(id: string|undefined): void {
    if (id === this.hovered) {
      return;
    }

    this.hovered = id;
    this.overlay.generation += 1;
  }

  setInteractive(interactive: boolean): void {
    this.interactive = interactive;
    if (!interactive) {
      this.stopEditing();
    }
  }

  isVisible(feature: EditableFeature): boolean {
    let at: EditableFeature|undefined = feature;
    while (at) {
      if (this.hidden.has(at.id)) {
        return false;
      }

      const parent = this.store.parentOf(at);
      at = parent !== undefined ? this.store.get(parent) : undefined;
    }
    return true;
  }

  override click(
      point: S2LatLng, px: [number, number], contextual: boolean, source: EventSource): boolean {
    if (!this.interactive) {
      return false;
    }

    const at = projectS2LatLng(point);
    const editing = this.editingLine();
    const vertex = editing && this.vertexAt(editing.points, at);
    if (vertex !== undefined) {
      this.activeVertex = vertex;
      this.overlay.generation += 1;
      return true;
    }

    const hit = this.hitTest(at);
    const now = performance.now();
    const doubled =
        hit?.kind === 'line'
            && this.lastClick?.id === hit.id
            && now - this.lastClick.timeMs < DOUBLE_CLICK_MS;
    if (doubled) {
      this.startEditing(hit.id);
    } else if (hit?.id !== this.editing) {
      this.stopEditing();
    }
    this.lastClick = hit ? {id: hit.id, timeMs: now} : undefined;
    source.trigger(FEATURE_CLICKED, {id: hit?.id});
    return !!hit;
  }

  override hover(point: S2LatLng, source: EventSource): boolean {
    if (!this.interactive || this.dragging) {
      return false;
    }

    const at = projectS2LatLng(point);
    const editing = this.editingLine();
    // A vertex handle under the pointer wins over inserting next to it.
    const inserting =
        editing && this.vertexAt(editing.points, at) === undefined
            ? this.insertAt(editing, at)
            : undefined;
    if (inserting || this.inserting) {
      this.inserting = inserting;
      this.overlay.generation += 1;
    }

    const hit = this.hitTest(at);
    if (hit?.id !== this.hovered) {
      this.setHovered(hit?.id);
      source.trigger(FEATURE_HOVERED, {id: hit?.id});
    }
    return !!hit;
  }

  override hoverLost(source: EventSource): void {
    if (this.inserting) {
      this.inserting = undefined;
      this.overlay.generation += 1;
    }
    if (this.hovered !== undefined) {
      this.setHovered(undefined);
      source.trigger(FEATURE_HOVERED, {id: undefined});
    }
  }

  override dragStart(point: S2LatLng, px: [number, number], source: EventSource): boolean {
    if (!this.interactive) {
      return false;
    }

    const at = projectS2LatLng(point);
    const editing = this.editingLine();
    if (editing) {
      const vertex = this.vertexAt(editing.points, at);
      if (vertex !== undefined) {
        this.activeVertex = vertex;
        this.startDrag(
            {kind: 'vertex', line: editing, index: vertex, points: editing.points.slice()});
        return true;
      }

      const insert = this.insertAt(editing, at);
      if (insert) {
        const {index} = insert;
        const points = new Float64Array(editing.points.length + 2);
        points.set(editing.points.subarray(0, 2 * index), 0);
        points[2 * index] = insert.at[0];
        points[2 * index + 1] = insert.at[1];
        points.set(editing.points.subarray(2 * index), 2 * index + 2);
        this.activeVertex = index;
        this.inserting = undefined;
        this.startDrag({kind: 'insert', line: editing, index, points});
        return true;
      }
    }

    const hit = this.pointAt(at);
    if (hit) {
      this.startDrag({kind: 'point', point: hit.feature, at: hit.at});
      return true;
    }
    return false;
  }

  override drag(point: S2LatLng, source: EventSource): void {
    const dragging = this.dragging;
    if (!dragging) {
      return;
    }

    const at = projectS2LatLng(point);
    if (dragging.kind === 'point') {
      dragging.at = at;
    } else {
      dragging.points[2 * dragging.index] = at[0];
      dragging.points[2 * dragging.index + 1] = at[1];
    }
    this.overlay.generation += 1;
  }

  override dragEnd(point: S2LatLng, moved: boolean, source: EventSource): void {
    const dragging = this.dragging;
    this.dragging = undefined;
    this.geometry.generation += 1;
    this.overlay.generation += 1;
    if (!dragging || !moved) {
      // An insert pressed and let go without moving was never a vertex.
      if (dragging?.kind === 'insert') {
        this.activeVertex = undefined;
      }
      return;
    }

    const latE7 = Math.round(point.latDegrees() * 1e7);
    const lngE7 = Math.round(point.lngDegrees() * 1e7);
    if (dragging.kind === 'point') {
      const before = snapshot(dragging.point);
      // The old elevation belongs to where the point was
      const after = {...snapshot(dragging.point), latE7, lngE7, elevationCentimeters: undefined};
      source.trigger(FEATURE_EDITED, {before, after});
      source.trigger(FEATURE_CLICKED, {id: dragging.point.id});
    } else {
      const line = dragging.line.feature;
      const after =
          dragging.kind === 'vertex'
              ? moveVertex(line, dragging.index, latE7, lngE7)
              : insertVertex(line, dragging.index, latE7, lngE7);
      source.trigger(FEATURE_EDITED, {before: snapshot(line), after});
    }
  }

  override keyPressed(key: string, source: EventSource): boolean {
    const editing = this.editingLine();
    if (!editing) {
      return false;
    }

    if (key === 'Escape') {
      this.stopEditing();
      return true;
    } else if ((key === 'Delete' || key === 'Backspace') && this.activeVertex !== undefined) {
      const after = removeVertex(editing.feature, this.activeVertex);
      if (after) {
        this.activeVertex = undefined;
        source.trigger(FEATURE_EDITED, {before: snapshot(editing.feature), after});
      }
      return true;
    }
    return false;
  }

  override viewportChanged(bounds: S2LatLngRect, zoom: number, fetchZoom: number): void {
    this.viewport = projectLatLngRect(bounds);
    this.overlay.generation += 1;
  }

  // Points win over lines because they sit on top of them.
  hitTest(at: Vec2): EditableFeature|undefined {
    const hit = this.pointAt(at);
    if (hit) {
      return hit.feature;
    }

    const pixel = this.camera.inverseWorldRadius;
    let best: EditableFeature|undefined = undefined;
    let bestDistance = Infinity;
    for (const line of this.visibleLines) {
      const radius = (lineRadius(line.feature) + CLICK_SLOP_PX) * pixel;
      const distance = distanceToPolyline(line.points, at, radius);
      if (distance <= radius && distance < bestDistance) {
        best = line.feature;
        bestDistance = distance;
      }
    }
    return best;
  }

  override hasNewData(): boolean {
    return this.geometry.generation !== this.geometry.planned
        || this.overlay.generation !== this.overlay.planned
        || this.labelsMissingGlyphs;
  }

  override render(planner: Planner, zoom: number): void {
    if (this.geometry.generation !== this.geometry.planned) {
      this.planGeometry();
      this.geometry.planned = this.geometry.generation;
    }
    if (this.overlay.generation !== this.overlay.planned) {
      this.planOverlay();
      this.overlay.planned = this.overlay.generation;
    }
    // Curved labels are laid out in pixels along mercator paths, so they follow the zoom.
    if (
        this.labelsMissingGlyphs
            || this.labelsPlanned.generation !== this.geometry.generation
            || this.labelsPlanned.zoom !== zoom) {
      this.planLabels(zoom);
      this.labelsPlanned = {generation: this.geometry.generation, zoom};
    }

    planner.add(this.geometry.drawables);
    planner.add(this.overlay.drawables);
    planner.add(this.labelDrawables);
  }

  private editingLine(): ProjectedLine|undefined {
    const line = this.editing !== undefined ? this.projected.get(this.editing) : undefined;
    return line && this.isVisible(line.feature) ? line : undefined;
  }

  private startEditing(id: string): void {
    this.editing = id;
    this.activeVertex = undefined;
    this.overlay.generation += 1;
  }

  private stopEditing(): void {
    if (this.editing === undefined) {
      return;
    }

    this.editing = undefined;
    this.activeVertex = undefined;
    this.inserting = undefined;
    this.overlay.generation += 1;
  }

  private startDrag(dragging: Drag): void {
    this.dragging = dragging;
    this.geometry.generation += 1;
    this.overlay.generation += 1;
  }

  private pointAt(at: Vec2): ProjectedPoint|undefined {
    const radius = (POINT_RADIUS_PX + CLICK_SLOP_PX) * this.camera.inverseWorldRadius;
    for (const point of this.visiblePoints) {
      if (Math.hypot(point.at[0] - at[0], point.at[1] - at[1]) <= radius) {
        return point;
      }
    }
    return undefined;
  }

  // The nearest vertex handle under at, if any.
  private vertexAt(points: Float64Array, at: Vec2): number|undefined {
    const radius = (HANDLE_SIZE_PX / 2 + CLICK_SLOP_PX) * this.camera.inverseWorldRadius;
    let best = undefined;
    let bestDistance = radius;
    for (const i of this.handles) {
      const distance = Math.hypot(points[2 * i] - at[0], points[2 * i + 1] - at[1]);
      if (distance <= bestDistance) {
        best = i;
        bestDistance = distance;
      }
    }
    return best;
  }

  // The nearest spot on the edited line to at, if the pointer is over the line, and the index a
  // vertex inserted there takes.
  private insertAt(line: ProjectedLine, at: Vec2): {index: number; at: Vec2}|undefined {
    const points = line.points;
    let best = (lineRadius(line.feature) + CLICK_SLOP_PX) * this.camera.inverseWorldRadius;
    let found = undefined;
    for (let i = 1; i < points.length / 2; ++i) {
      const ax = points[2 * i - 2];
      const ay = points[2 * i - 1];
      const dx = points[2 * i] - ax;
      const dy = points[2 * i + 1] - ay;
      const length2 = dx * dx + dy * dy;
      const t =
          length2 > 0
              ? Math.max(0, Math.min(1, ((at[0] - ax) * dx + (at[1] - ay) * dy) / length2))
              : 0;
      const x = ax + t * dx;
      const y = ay + t * dy;
      const distance = Math.hypot(at[0] - x, at[1] - y);
      if (distance <= best) {
        best = distance;
        found = {index: i, at: [x, y] as Vec2};
      }
    }
    return found;
  }

  private createPlan(byteLength: number): Plan {
    const glBuffer = this.renderer.createDataBuffer(byteLength);
    this.registerDisposer(() => {
      this.renderer.deleteBuffer(glBuffer);
    });
    return {
      buffer: new ArrayBuffer(byteLength),
      glBuffer,
      drawables: [],
      generation: 0,
      planned: -1,
    };
  }

  private refresh(): void {
    const lines = this.store.lines();
    const live = new Set<string>();
    this.visibleLines = [];
    for (const line of lines) {
      live.add(line.id);
      let projected = this.projected.get(line.id);
      if (!projected || projected.latLngE7 !== line.latLngE7) {
        const points = projectE7Array(line.latLngE7);
        projected = {feature: line, latLngE7: line.latLngE7, points, label: undefined};
        this.projected.set(line.id, projected);
      }
      projected.feature = line;
      if (this.isVisible(line)) {
        this.visibleLines.push(projected);
      }
    }
    for (const id of [...this.projected.keys()]) {
      if (!live.has(id)) {
        this.projected.delete(id);
      }
    }

    this.visiblePoints = [];
    for (const point of this.store.points()) {
      if (this.isVisible(point)) {
        this.visiblePoints.push({
          feature: point,
          at: projectS2LatLng(S2LatLng.fromE7(point.latE7, point.lngE7)),
        });
      }
    }

    this.publish();
    this.geometry.generation += 1;
    this.overlay.generation += 1;
  }

  // Puts visible lines into the index so that drawing snaps onto them and routes along them. A
  // vertex that snapped onto a line's vertex sits on it exactly, since E7 round trips those
  // coordinates, and an end that snapped partway along a segment joins it within
  // DRAWN_TOLERANCE.
  //
  // Each line is its own group, keyed by its id, so that editing one line does not reproject
  // every other.
  private publish(): void {
    const wanted = new Map<string, ProjectedLine>();
    for (const line of this.visibleLines) {
      wanted.set(line.feature.id, line);
    }

    const stale = [];
    for (const [id, latLngE7] of this.published) {
      if (wanted.get(id)?.latLngE7 !== latLngE7) {
        stale.push(id);
      }
    }
    if (stale.length > 0) {
      this.locations.unload(stale.map(id => this.key(id)));
      for (const id of stale) {
        this.published.delete(id);
      }
    }

    for (const [id, line] of wanted) {
      if (this.published.has(id)) {
        continue;
      }

      const key = this.key(id);
      // Drawn and imported lines share no vertices where they meet, so they join where they cross.
      this.locations.load(
          key, DRAWN_TOLERANCE, [{id: key, points: line.points}], [], /* crossings= */ true);
      this.published.set(id, line.latLngE7);
    }
  }

  private key(id: string): string {
    return `${this.producer}${id}`;
  }

  private planGeometry(): void {
    const dragged =
        this.dragging?.kind === 'point' ? this.dragging.point.id : this.dragging?.line.feature.id;
    const lines = this.visibleLines.filter(l => l.feature.id !== dragged);
    const points = this.visiblePoints.filter(p => p.feature.id !== dragged);
    const selectedLine = lines.find(l => l.feature.id === this.selected);
    let needed = 0;
    for (const line of lines) {
      needed += LineProgram.bytesNeeded(line.points.length / 2);
    }
    if (selectedLine) {
      needed += LineProgram.bytesNeeded(selectedLine.points.length / 2);
    }
    needed += points.length * LineProgram.bytesNeeded(2);

    const batch = new ShapeBatch(this.geometry, needed, this.renderer);
    for (const line of lines) {
      const color = parseColor(line.feature.data.stroke ?? DEFAULT_LINE_COLOR);
      batch.push(color, darken(color), lineRadius(line.feature), line.points, Z_LINE, 'both');
    }
    if (selectedLine) {
      const color = parseColor(selectedLine.feature.data.stroke ?? DEFAULT_LINE_COLOR);
      batch.push(
          color,
          SELECTED_CASING,
          lineRadius(selectedLine.feature) + 2,
          selectedLine.points,
          Z_SELECTED_LINE,
          'both');
    }
    for (const point of points) {
      const color = parseColor(point.feature.data.fill ?? DEFAULT_POINT_COLOR);
      const selected = point.feature.id === this.selected;
      // A zero length segment, which the cap program draws as a circle
      batch.push(
          color,
          selected ? SELECTED_CASING : POINT_CASING,
          selected ? SELECTED_POINT_RADIUS_PX : POINT_RADIUS_PX,
          [point.at[0], point.at[1], point.at[0], point.at[1]],
          Z_POINT,
          'caps');
    }
    batch.finish();
  }

  private planOverlay(): void {
    const dragging = this.dragging;
    const editing = this.editingLine();
    const linePoints =
        dragging && dragging.kind !== 'point' ? dragging.points : editing?.points;

    // The same squares the drawing tools place, hollow except for the vertex picked last
    const handles: Handle[] = [];
    // A drag keeps the handles it started with, so the one under the pointer stays grabbable.
    if (!dragging) {
      this.handles = [];
    }
    if (editing && linePoints) {
      const pixel = this.camera.inverseWorldRadius;
      const {low, high} = this.viewport;
      const inView = (x: number, y: number) =>
          x >= low[0] && x <= high[0] && y >= low[1] && y <= high[1];
      const kept = new Set(this.handles);
      let lastX = Infinity;
      let lastY = Infinity;
      const last = linePoints.length / 2 - 1;
      for (let i = 0; i <= last; ++i) {
        const x = linePoints[2 * i];
        const y = linePoints[2 * i + 1];
        // Ends always get handles, because they are what extending a line grabs.
        const spaced =
            i === 0 || i === last || Math.hypot(x - lastX, y - lastY) >= HANDLE_SPACING_PX * pixel;
        const handled = dragging ? kept.has(i) : spaced && inView(x, y);
        if (!dragging && handled) {
          this.handles.push(i);
        }
        if (spaced) {
          lastX = x;
          lastY = y;
        }
        if (handled || i === this.activeVertex) {
          handles.push({at: [x, y], filled: i === this.activeVertex, sizePx: HANDLE_SIZE_PX});
        }
      }
    }
    const inserting = this.inserting;
    if (inserting && !dragging) {
      handles.push({at: inserting.at, filled: false, sizePx: INSERT_HANDLE_SIZE_PX});
    }

    // The selected feature already has its highlight, and a dragged one is drawn below.
    const hoveredId =
        this.hovered !== this.selected && !dragging ? this.hovered : undefined;
    const hoveredLine = this.visibleLines.find(l => l.feature.id === hoveredId);
    const hoveredPoint = this.visiblePoints.find(p => p.feature.id === hoveredId);
    let needed =
        handleBytesNeeded(handles.length)
            + (hoveredLine ? LineProgram.bytesNeeded(hoveredLine.points.length / 2) : 0)
            + (hoveredPoint ? LineProgram.bytesNeeded(2) : 0);
    if (dragging?.kind === 'point') {
      needed += LineProgram.bytesNeeded(2);
    } else if (dragging) {
      needed += LineProgram.bytesNeeded(dragging.points.length / 2);
    }

    const batch = new ShapeBatch(this.overlay, needed, this.renderer);
    if (hoveredLine) {
      const color = parseColor(hoveredLine.feature.data.stroke ?? DEFAULT_LINE_COLOR);
      batch.push(
          color,
          HOVERED_CASING,
          lineRadius(hoveredLine.feature) + 2,
          hoveredLine.points,
          Z_SELECTED_LINE,
          'both');
    }
    if (hoveredPoint) {
      const color = parseColor(hoveredPoint.feature.data.fill ?? DEFAULT_POINT_COLOR);
      const at = hoveredPoint.at;
      batch.push(
          color,
          HOVERED_CASING,
          SELECTED_POINT_RADIUS_PX,
          [at[0], at[1], at[0], at[1]],
          Z_DRAGGED,
          'caps');
    }
    if (dragging?.kind === 'point') {
      const color = parseColor(dragging.point.data.fill ?? DEFAULT_POINT_COLOR);
      const at = dragging.at;
      batch.push(
          color,
          SELECTED_CASING,
          SELECTED_POINT_RADIUS_PX,
          [at[0], at[1], at[0], at[1]],
          Z_DRAGGED,
          'caps');
    } else if (dragging) {
      const line = dragging.line.feature;
      const color = parseColor(line.data.stroke ?? DEFAULT_LINE_COLOR);
      batch.push(
          color, SELECTED_CASING, lineRadius(line) + 2, dragging.points, Z_DRAGGED, 'both');
    }
    batch.pushHandles(handles, Z_HANDLE, this.handleTexture);
    batch.finish();
  }

  private planLabels(zoom: number): void {
    const labeled: Array<{graphemes: string[]; line?: ProjectedLine; point?: ProjectedPoint}> = [];
    let needed = 0;
    for (const line of this.visibleLines) {
      const name = line.feature.data.name;
      if (name) {
        const graphemes = toGraphemes(name);
        needed += GLYPHER.bytesNeeded(graphemes);
        labeled.push({graphemes, line});
      }
    }
    for (const point of this.visiblePoints) {
      const name = point.feature.data.name;
      if (name) {
        const graphemes = toGraphemes(name);
        needed += GLYPHER.bytesNeeded(graphemes);
        labeled.push({graphemes, point});
      }
    }
    this.labels = growBuffer(this.labels, needed);

    // Pixels per mercator unit, see mbtile_layer.ts#render.
    const pixelsPerWorld = 256 * Math.pow(2, zoom - 1);
    const drawables = [];
    let offset = 0;
    this.labelsMissingGlyphs = false;
    for (const {graphemes, line, point} of labeled) {
      if (!GLYPHER.measurePx(graphemes, LABEL_SCALE)) {
        this.labelsMissingGlyphs = true;
        continue;
      }

      if (point) {
        const planned =
            GLYPHER.plan(
                graphemes,
                point.at,
                labelOffset(graphemes),
                LABEL_SCALE,
                /* angle= */ 0,
                LABEL_FILL,
                LABEL_STROKE,
                Z_LABEL,
                this.labels,
                offset,
                this.glLabels,
                this.renderer);
        drawables.push(...planned.drawables);
        offset += planned.byteSize;
        continue;
      }

      const path = labelPath(line!, zoom);
      for (const anchor of path.anchors) {
        const planned =
            GLYPHER.planCurved(
                graphemes,
                path.points.subarray(2 * anchor),
                pixelsPerWorld,
                LABEL_SCALE,
                LABEL_FILL,
                LABEL_STROKE,
                Z_LABEL,
                this.labels,
                offset,
                this.glLabels,
                this.renderer);
        if (planned.drawables.length > 0) {
          drawables.push(...planned.drawables);
          offset += planned.byteSize;
          break;
        }
      }
    }

    if (offset > 0) {
      this.renderer.uploadData(this.labels, offset, this.glLabels);
    }
    this.labelDrawables = drawables;
  }
}

// Writes LineProgram shapes into a plan's buffer and collects the drawables that read them.
class ShapeBatch {

  private readonly drawables: Drawable[];
  private offset: number;

  constructor(private readonly plan: Plan, needed: number, private readonly renderer: Renderer) {
    plan.buffer = growBuffer(plan.buffer, needed);
    this.drawables = [];
    this.offset = 0;
  }

  pushHandles(handles: Handle[], z: number, texture: WebGLTexture): void {
    const planned =
        planHandles(
            handles, z, this.plan.buffer, this.offset, this.plan.glBuffer, texture, this.renderer);
    this.drawables.push(...planned.drawables);
    this.offset += planned.byteSize;
  }

  // Caps alone draw a circle at every vertex, which is how points are drawn.
  push(
      fill: RgbaU32,
      stroke: RgbaU32,
      radius: number,
      points: ArrayLike<number>,
      z: number,
      joins: 'line'|'caps'|'both'): void {
    const result =
        LineProgram.push(
            fill, stroke, radius, /* stipple= */ false, points, this.plan.buffer, this.offset);
    this.offset += result.geometryByteLength;
    if (result.instanceCount === 0) {
      return;
    }

    const drawable = {
      elements: undefined,
      geometry: this.plan.glBuffer,
      geometryByteLength: result.geometryByteLength,
      geometryOffset: result.geometryOffset,
      instanced: {
        count: result.instanceCount,
      },
      program: this.renderer.lineProgram,
      texture: undefined,
      vertexCount: result.vertexCount,
      z,
    };
    if (joins !== 'caps') {
      this.drawables.push(drawable);
    }
    // Circles at the joins, or else a corner shows the gap between two unmitered rectangles.
    if (joins !== 'line') {
      this.drawables.push({...drawable, program: this.renderer.lineCapProgram});
    }
  }

  finish(): void {
    if (this.offset > 0) {
      this.renderer.uploadData(this.plan.buffer, this.offset, this.plan.glBuffer);
    }
    this.plan.drawables = this.drawables;
  }
}

// Glypher centers text on its anchor, so shifting by half the width puts it right of the marker.
function labelOffset(graphemes: string[]): Vec2 {
  const size = GLYPHER.measurePx(graphemes, LABEL_SCALE);
  return [LABEL_OFFSET_PX[0] + (size ? size[0] / 2 : 0), LABEL_OFFSET_PX[1]];
}

// Returns the distance from at to the nearest segment, or Infinity when every segment is further
// than cutoff, which lets most segments go by their bounding box alone.
function distanceToPolyline(points: Float64Array, at: Vec2, cutoff: number): number {
  let best = Infinity;
  for (let i = 2; i < points.length; i += 2) {
    const ax = points[i - 2];
    const ay = points[i - 1];
    const bx = points[i];
    const by = points[i + 1];
    if (
        at[0] < Math.min(ax, bx) - cutoff
            || at[0] > Math.max(ax, bx) + cutoff
            || at[1] < Math.min(ay, by) - cutoff
            || at[1] > Math.max(ay, by) + cutoff) {
      continue;
    }

    const dx = bx - ax;
    const dy = by - ay;
    const length2 = dx * dx + dy * dy;
    const t =
        length2 > 0
            ? Math.max(0, Math.min(1, ((at[0] - ax) * dx + (at[1] - ay) * dy) / length2))
            : 0;
    best = Math.min(best, Math.hypot(at[0] - ax - t * dx, at[1] - ay - t * dy));
  }
  return best;
}

function lineRadius(line: EditableLine): number {
  return (line.data.width_px ?? DEFAULT_WIDTH_PX) / 2 + CASING_PX;
}

function labelPath(line: ProjectedLine, zoom: number):
    {points: Float64Array; anchors: number[]} {
  const level = Math.floor(zoom);
  if (line.label?.zoom !== level) {
    // Simplified for the integer zoom, so the path holds still while zooming within it
    const points =
        simplify(line.points, LABEL_PATH_TOLERANCE_PX / (256 * Math.pow(2, level - 1)));
    line.label = {zoom: level, points, anchors: anchorVertices(points)};
  }
  return line.label;
}

// Returns the vertex reached at each of LABEL_ANCHORS along the path.
function anchorVertices(points: Float64Array): number[] {
  const along = [0];
  for (let i = 2; i < points.length; i += 2) {
    along.push(
        along[along.length - 1]
            + Math.hypot(points[i] - points[i - 2], points[i + 1] - points[i - 1]));
  }

  const total = along[along.length - 1];
  return LABEL_ANCHORS.map(fraction => {
    const index = along.findIndex(d => d >= total * fraction);
    return index < 0 ? 0 : index;
  });
}

function simplify(points: Float64Array, tolerance: number): Float64Array {
  const keep = SimpleS2.douglasPeucker(points, tolerance, /* pinned= */ null);
  const simplified = [];
  for (let i = 0; i < keep.length; ++i) {
    if (keep[i]) {
      simplified.push(points[2 * i], points[2 * i + 1]);
    }
  }
  return Float64Array.from(simplified);
}

export function parseColor(hex: string): RgbaU32 {
  const rgb = parseInt(hex.slice(1), 16);
  return (((Number.isNaN(rgb) ? 0 : rgb) << 8) | 0xFF) >>> 0 as RgbaU32;
}

function darken(color: RgbaU32): RgbaU32 {
  const r = Math.round(((color >>> 24) & 0xFF) * 0.4);
  const g = Math.round(((color >>> 16) & 0xFF) * 0.4);
  const b = Math.round(((color >>> 8) & 0xFF) * 0.4);
  return ((r << 24) | (g << 16) | (b << 8) | (color & 0xFF)) >>> 0 as RgbaU32;
}
