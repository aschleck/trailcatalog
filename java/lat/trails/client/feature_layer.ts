import { S2LatLng, S2LatLngRect } from 'java/org/trailcatalog/s2';
import { SimpleS2 } from 'java/org/trailcatalog/s2/SimpleS2';
import {
  Camera,
  projectE7Array,
  projectLatLngRect,
  projectS2LatLng,
  unprojectS2LatLng,
  worldRadiusAt,
} from 'js/map/camera';
import { Copyright, RgbaU32, Vec2 } from 'js/map/common/types';
import { EventSource, Layer } from 'js/map/layer';
import { growBuffer } from 'js/map/rendering/buffers';
import { GLYPHER, toGraphemes, wrap } from 'js/map/rendering/glypher';
import { LineProgram, Stipple } from 'js/map/rendering/line_program';
import { Planner } from 'js/map/rendering/planner';
import { Drawable } from 'js/map/rendering/program';
import { Renderer } from 'js/map/rendering/renderer';
import { LocationIndex } from 'js/map/workers/location_index';
import { LineRef, Route } from 'js/map/workers/location_querier';
import { Z_USER_DATA, Z_USER_DATA_HIGHLIGHT } from 'js/map/z';

import { SNAP_RADIUS_PX, toE7Array } from './drawing_layer';
import { FeatureStore } from './feature_store';
import {
  FEATURE_CLICKED,
  FEATURE_CONTEXT_MENU,
  FEATURE_EDITED,
  FEATURE_HOVERED,
  LineSpot,
} from './events';
import {
  DEFAULT_ICON,
  DEFAULT_ICON_SHRINK,
  DEFAULT_LINE_COLOR,
  DEFAULT_POINT_COLOR,
  DEFAULT_WIDTH_PX,
  EditableFeature,
  EditableLine,
  EditablePoint,
  isMarker,
  pointIcon,
  snapshot,
} from './features';
import {
  createHandleTexture,
  Handle,
  HANDLE_COLOR,
  HANDLE_SIZE_PX,
  handleBytesNeeded,
  INSERT_HANDLE_SIZE_PX,
  planHandles,
} from './handles';
import { LatestQuery } from './latest_query';
import { insertVertex, moveVertex, removeVertex, rerouteLine } from './line_edits';
import {
  appendRoute,
  emptyTrace,
  nearestOn,
  pushPoint,
  refine,
  Traced,
  traceRefs,
} from './line_matching';
import { LineRefiner } from './line_refiner';
import { DEFAULT_MARKER_WIDTH_PX, MarkerOutline, outlineMarker, pushMarker } from './marker';
import { CollectionSchema, lineLook, pointLook, toStipple } from './schema';
import { ShiftKey } from './shift_key';

// How far past a feature's drawn edge a click still lands on it
const CLICK_SLOP_PX = 3;
// The casing LineProgram draws is a pixel wide on each side, see line_cap_program.ts.
const CASING_PX = 1;
const SELECTED_CASING = 0xFFFFFFFF as RgbaU32;
const HOVERED_CASING = 0xFFFFFF99 as RgbaU32;
// Same as the measure tool's, see drawing_layer.ts
const MARKER_RADIUS_PX = 6;
const MARKER_STROKE = 0xFFFFFFFF as RgbaU32;
// A little wider than a default line, so it shows on the line rather than in it
const GRAB_RADIUS_PX = 5;
const GRAB_FILL = 0xFFFFFFFF as RgbaU32;
const LABEL_FILL = 0x1A1A1AFF as RgbaU32;
const LABEL_STROKE = 0xFFFFFFFF as RgbaU32;
// FONT_SIZE is 28, so labels are 14px.
const LABEL_SCALE = 0.5;
const LABEL_GAP_PX = 4;
// Point names are often notes that run to a sentence, so we wrap them wider than the basemap's
// place names.
const LABEL_LINE_GRAPHEMES = 20;
// FONT_SIZE is 28, so icons are about 17px.
const ICON_SCALE = 0.6;
// A hovered or selected icon grows, the way a hovered or selected line widens, because a ring
// behind it vanishes against some icons and terrain.
const HIGHLIGHTED_ICON_SCALE = 0.8;
// Wide enough to ring an icon, and how far from its center a click still lands on it
const ICON_RADIUS_PX = 10;
// Tracks recorded by GPS wiggle every few meters, and Glypher refuses to bend text around turns
// that sharp, so a label follows the line simplified to about this many pixels.
const LABEL_PATH_TOLERANCE_PX = 4;
// Where along a line to try starting its label, as fractions of its length, best first
const LABEL_ANCHORS = [0.5, 0.3, 0.7, 0.15, 0.85];


// A GPS track has a vertex every few meters, which at most zooms is several per pixel, so a vertex
// only gets a handle once it is this far from the last one that did.
const HANDLE_SPACING_PX = 12;

const Z_LINE = Z_USER_DATA;
const Z_SELECTED_LINE = Z_USER_DATA_HIGHLIGHT;
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
  // Set on a marker stroke, as of the size and zoom it was outlined at
  marker: {widthPx: number; zoom: number; outline: MarkerOutline}|undefined;
  look: {label: string|undefined; stipple: Stipple; stroke: RgbaU32; widthPx: number};
}

interface ProjectedPoint {
  feature: EditablePoint;
  at: Vec2;
  look: {fill: RgbaU32; icon: string; label: string|undefined};
}

// What the pointer is moving. Line drags work on a mercator copy of the line with the vertex
// moved, or inserted where the insert marker was, which becomes the edit when the drag ends.
type Drag =
    {kind: 'point'; point: EditablePoint; at: Vec2}
    // A marker stroke moves whole, by how far the pointer has come from where it was pressed.
    |{kind: 'marker'; line: ProjectedLine; from: Vec2; by: Vec2}
    |LineDrag;

type LineDrag = VertexDrag|Reroute;

// A press that never moves is a click, so the line stays in the index until the first move. After
// the drop it waits on its last query before becoming an edit.
type LineDragPhase = 'pressed'|'moving'|'settling';

// Pointer is where the vertex would go unsnapped, and query snaps it onto a line under it.
interface VertexDrag {
  kind: 'vertex'|'insert';
  phase: LineDragPhase;
  line: ProjectedLine;
  index: number;
  points: Float64Array;
  pointer: Vec2;
  query: LatestQuery<Vec2, {point: Vec2; line: LineRef|undefined}>;
  // The last snap moved onto the unsimplified line, once the drop has fetched it
  refined: Vec2|undefined;
}

// A line routed again from its start through the pointer to its end
interface Reroute {
  kind: 'reroute';
  phase: LineDragPhase;
  line: ProjectedLine;
  query: LatestQuery<Vec2, Traced>;
  // The last route along the unsimplified lines, once the drop has fetched them
  refined: Float64Array|undefined;
}

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
  // Marker strokes scale with the map but LineProgram radii are in pixels, so these replan on
  // every zoom.
  private readonly markers: Plan;
  private markersZoom: number;
  private readonly glLabels: WebGLBuffer;
  private readonly handleTexture: WebGLTexture;
  private labels: ArrayBuffer;
  private labelDrawables: Drawable[];
  // Icons draw with the labels, so the hovered one changing replans them too.
  private labelsPlanned: {
    draggedAt: Vec2|undefined;
    generation: number;
    hovered: string|undefined;
    selected: string|undefined;
    zoom: number;
  };
  // Only the pointer tool selects, drags, and edits, or else a drawing tool's clicks would also
  // grab whatever is under them.
  private interactive: boolean;
  // Points stay draggable under the point tool, so that one placed in the wrong spot can be moved
  // without switching tools.
  private pointsDraggable: boolean;
  // The line showing its vertex handles, entered by clicking it
  private editing: string|undefined;
  // The handle a click picked, which Delete removes
  private activeVertex: number|undefined;
  // Where on the edited line the pointer is, and the index a vertex dragged from there takes
  private inserting: {index: number; at: Vec2}|undefined;
  // The vertices of the edited line that have handles, as of the last overlay plan
  private handles: number[];
  // Includes a dropped line drag until it settles, which draws in place of its line until then
  private dragging: Drag|undefined;
  // Where on the hovered line a drag would grab it to reroute
  private grab: {line: ProjectedLine; at: Vec2}|undefined;
  // Shift suspends snapping, so a vertex can sit just off a line.
  private readonly shift: ShiftKey;
  // In mercator, for culling handles to what is on screen
  private viewport: {low: Vec2; high: Vec2};
  // The spot a line profile's pointer is over, in mercator
  private marker: Vec2|undefined;
  // Glypher builds its atlas asynchronously and plans nothing for a grapheme it lacks, so labels
  // planned before the atlas holds them have to be planned again once it does.
  private labelsMissingGlyphs: boolean;

  constructor(
      copyrights: Copyright[],
      private readonly store: FeatureStore,
      // Where lines go so that drawing snaps and routes along them
      private readonly locations: LocationIndex,
      // Swaps the simplified lines a drag snapped or routed along for unsimplified ones
      private readonly refiner: LineRefiner,
      private readonly camera: Camera,
      private readonly renderer: Renderer,
  ) {
    super(copyrights);
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
    // A few dozen strokes
    this.markers = this.createPlan(64 * 1024);
    this.markersZoom = -1;
    this.glLabels = renderer.createDataBuffer(16 * 1024);
    this.handleTexture = createHandleTexture(renderer);
    this.labels = new ArrayBuffer(16 * 1024);
    this.labelDrawables = [];
    this.labelsPlanned = {
      draggedAt: undefined,
      generation: -1,
      hovered: undefined,
      selected: undefined,
      zoom: -1,
    };
    this.labelsMissingGlyphs = false;
    this.interactive = true;
    this.pointsDraggable = false;
    this.editing = undefined;
    this.activeVertex = undefined;
    this.inserting = undefined;
    this.handles = [];
    this.dragging = undefined;
    this.grab = undefined;
    this.viewport = {low: [-1, -1], high: [1, 1]};
    this.marker = undefined;
    this.registerDisposer(() => {
      renderer.deleteBuffer(this.glLabels);
      renderer.deleteTexture(this.handleTexture);
      this.locations.unload([...this.published.keys()].map(id => this.key(id)));
    });

    store.listen(() => {
      this.refresh();
    });

    // A dragged vertex follows the pointer rather than its snap while shift is down.
    this.shift = new ShiftKey(() => {
      this.overlay.generation += 1;
    });
    this.registerDisposable(this.shift);
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
    this.markers.generation += 1;
  }

  setHovered(id: string|undefined): void {
    if (id === this.hovered) {
      return;
    }

    this.hovered = id;
    this.overlay.generation += 1;
    this.markers.generation += 1;
  }

  /** Marks a spot, which is what a line profile's pointer is over. */
  setMarker(at: Vec2|undefined): void {
    this.marker = at;
    this.overlay.generation += 1;
  }

  setPointsDraggable(draggable: boolean): void {
    this.pointsDraggable = draggable;
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
    if (contextual) {
      this.contextClick(point, at, px, source);
      return true;
    }

    const editing = this.editingLine();
    const vertex = editing && this.vertexAt(editing.points, at);
    if (vertex !== undefined) {
      this.activeVertex = vertex;
      this.overlay.generation += 1;
      return true;
    }

    return false;
  }

  /** Shows the vertex handles of the feature when it's an editable line, and hides any others. */
  edit(feature: EditableFeature|undefined): void {
    if (feature?.kind === 'line' && !isMarker(feature) && !this.store.isReadOnly()) {
      if (feature.id !== this.editing) {
        this.startEditing(feature.id);
      }
    } else {
      this.stopEditing();
    }
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

    // The edited line already shows where a drag inserts a vertex.
    const grabbable =
        hit?.kind === 'line'
            && !isMarker(hit)
            && hit.id !== this.editing
            && !this.store.isReadOnly();
    const line = grabbable ? this.projected.get(hit.id) : undefined;
    const nearest = line && nearestOnPolyline(line.points, at);
    if (line && nearest) {
      this.grab = {line, at: nearest.at};
      this.overlay.generation += 1;
    } else if (this.grab) {
      this.grab = undefined;
      this.overlay.generation += 1;
    }
    return !!hit;
  }

  override hoverLost(source: EventSource): void {
    if (this.inserting || this.grab) {
      this.inserting = undefined;
      this.grab = undefined;
      this.overlay.generation += 1;
    }
    if (this.hovered !== undefined) {
      this.setHovered(undefined);
      source.trigger(FEATURE_HOVERED, {id: undefined});
    }
  }

  // Without interactive nothing is being edited, so only a point drag can start.
  override dragStart(point: S2LatLng, px: [number, number], source: EventSource): boolean {
    if ((!this.interactive && !this.pointsDraggable) || this.store.isReadOnly()) {
      return false;
    }

    const at = projectS2LatLng(point);
    const editing = this.editingLine();
    if (editing) {
      const vertex = this.vertexAt(editing.points, at);
      if (vertex !== undefined) {
        this.activeVertex = vertex;
        this.startDrag(this.vertexDrag('vertex', editing, vertex, editing.points.slice(), at));
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
        this.startDrag(this.vertexDrag('insert', editing, index, points, at));
        return true;
      }
    }

    const hit = this.pointsAt(at)[0];
    if (hit) {
      this.startDrag({kind: 'point', point: hit.feature, at: hit.at});
      return true;
    }

    const line = this.interactive ? this.hitTest(at) : undefined;
    const stroke =
        line?.kind === 'line' && isMarker(line) ? this.projected.get(line.id) : undefined;
    if (stroke) {
      this.startDrag({kind: 'marker', line: stroke, from: at, by: [0, 0]});
      return true;
    }

    // Only from the grab handle, so that a touch, which never hovers, pans across lines instead of
    // grabbing them.
    const path = this.grab && line?.id === this.grab.line.feature.id ? this.grab.line : undefined;
    if (path) {
      this.startDrag({
        kind: 'reroute',
        phase: 'pressed',
        line: path,
        query: new LatestQuery(
            through => this.routeThrough(path.points, through)
                .then(route => this.redrawOverlay(route))),
        refined: undefined,
      });
      return true;
    }
    return false;
  }

  override drag(point: S2LatLng, source: EventSource): void {
    const dragging = this.dragging;
    if (!dragging) {
      return;
    }

    if (isLineDrag(dragging) && dragging.phase === 'pressed') {
      dragging.phase = 'moving';
      this.publish();
    }

    const at = projectS2LatLng(point);
    if (dragging.kind === 'point') {
      dragging.at = at;
    } else if (dragging.kind === 'marker') {
      dragging.by = [at[0] - dragging.from[0], at[1] - dragging.from[1]];
      this.markers.generation += 1;
    } else if (dragging.kind === 'reroute') {
      dragging.query.set(at);
    } else {
      dragging.pointer = at;
      dragging.query.set(at);
    }
    this.overlay.generation += 1;
  }

  override dragEnd(point: S2LatLng, moved: boolean, source: EventSource): void {
    const dragging = this.dragging;
    if (isLineDrag(dragging) && moved) {
      dragging.phase = 'settling';
      dragging.query.settled()
          .then(() => this.refineDrag(dragging))
          .then(() => {
            this.settle(dragging, source);
          });
    } else {
      this.setDragging(undefined);
    }
    this.geometry.generation += 1;
    this.overlay.generation += 1;
    this.markers.generation += 1;
    if (!dragging || !moved) {
      // An insert pressed and let go without moving was never a vertex.
      if (dragging?.kind === 'insert') {
        this.activeVertex = undefined;
      }
      return;
    }

    if (dragging.kind === 'point') {
      const latE7 = Math.round(point.latDegrees() * 1e7);
      const lngE7 = Math.round(point.lngDegrees() * 1e7);
      const before = snapshot(dragging.point);
      // The old elevation belongs to where the point was
      const after = {...snapshot(dragging.point), latE7, lngE7, elevationCentimeters: undefined};
      source.trigger(FEATURE_EDITED, {before, after});
      source.trigger(FEATURE_CLICKED, {id: dragging.point.id});
    } else if (dragging.kind === 'marker') {
      const line = dragging.line;
      const after = {
        ...snapshot(line.feature),
        latLngE7: toE7Array(translate(line.points, dragging.by)),
      };
      source.trigger(FEATURE_EDITED, {before: snapshot(line.feature), after});
      source.trigger(FEATURE_CLICKED, {id: line.feature.id});
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

  hitTest(at: Vec2): EditableFeature|undefined {
    return this.featuresAt(at)[0];
  }

  // Points come ahead of lines because they sit on top of them, and then the nearest line first.
  featuresAt(at: Vec2): EditableFeature[] {
    const pixel = this.camera.inverseWorldRadius;
    const points = this.pointsAt(at).map(point => point.feature);

    const lines: Array<{feature: EditableFeature; distance: number}> = [];
    for (const line of this.visibleLines) {
      const radius =
          line.marker
              ? line.marker.outline.maxRadius + CLICK_SLOP_PX * pixel
              : (lineRadius(line) + CLICK_SLOP_PX) * pixel;
      const distance = distanceToPolyline(line.points, at, radius);
      if (distance <= radius) {
        lines.push({feature: line.feature, distance});
      }
    }
    lines.sort((a, b) => a.distance - b.distance);
    return [...points, ...lines.map(({feature}) => feature)];
  }

  override hasNewData(): boolean {
    return this.geometry.generation !== this.geometry.planned
        || this.overlay.generation !== this.overlay.planned
        || this.markers.generation !== this.markers.planned
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
    if (this.markers.generation !== this.markers.planned || this.markersZoom !== zoom) {
      this.planMarkers();
      this.markers.planned = this.markers.generation;
      this.markersZoom = zoom;
    }
    // Curved labels are laid out in pixels along mercator paths, so they follow the zoom.
    const draggedAt = this.dragging?.kind === 'point' ? this.dragging.at : undefined;
    if (
        this.labelsMissingGlyphs
            || this.labelsPlanned.draggedAt !== draggedAt
            || this.labelsPlanned.generation !== this.geometry.generation
            || this.labelsPlanned.hovered !== this.hovered
            || this.labelsPlanned.selected !== this.selected
            || this.labelsPlanned.zoom !== zoom) {
      this.planLabels(zoom);
      this.labelsPlanned = {
        draggedAt,
        generation: this.geometry.generation,
        hovered: this.hovered,
        selected: this.selected,
        zoom,
      };
    }

    planner.add(this.geometry.drawables);
    planner.add(this.overlay.drawables);
    planner.add(this.markers.drawables);
    planner.add(this.labelDrawables);
  }

  private isHighlighted(feature: EditableFeature): boolean {
    return feature.id === this.hovered
        || feature.id === this.selected
        || (this.dragging?.kind === 'point' && feature.id === this.dragging.point.id);
  }

  private iconScale(point: ProjectedPoint): number {
    const scale = this.isHighlighted(point.feature) ? HIGHLIGHTED_ICON_SCALE : ICON_SCALE;
    return point.look.icon === DEFAULT_ICON ? scale * DEFAULT_ICON_SHRINK : scale;
  }

  private editingLine(): ProjectedLine|undefined {
    const line = this.editing !== undefined ? this.projected.get(this.editing) : undefined;
    return line && this.isVisible(line.feature) ? line : undefined;
  }

  private startEditing(id: string): void {
    this.editing = id;
    this.activeVertex = undefined;
    this.grab = undefined;
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
    this.setDragging(dragging);
    this.grab = undefined;
    this.geometry.generation += 1;
    this.overlay.generation += 1;
    this.markers.generation += 1;
  }

  // Republishes when the line out of the index changes.
  private setDragging(dragging: Drag|undefined): void {
    const before = this.unindexed();
    this.dragging = dragging;
    if (this.unindexed() !== before) {
      this.publish();
    }
  }

  // The dragged line from its first move until it settles
  private unindexed(): string|undefined {
    const dragging = this.dragging;
    return isLineDrag(dragging) && dragging.phase !== 'pressed'
        ? dragging.line.feature.id
        : undefined;
  }

  private vertexDrag(
      kind: 'vertex'|'insert', line: ProjectedLine, index: number, points: Float64Array, at: Vec2):
      VertexDrag {
    // Only a line under the dragged handle, so a vertex can still be placed close beside one
    const radius = HANDLE_SIZE_PX / 2 * this.camera.inverseWorldRadius;
    return {
      kind,
      phase: 'pressed',
      line,
      index,
      points,
      pointer: at,
      query: new LatestQuery(
          pointer => this.locations
              .querySnap(pointer, radius)
              .then(snapped => this.redrawOverlay(snapped ?? {point: pointer, line: undefined}))),
      refined: undefined,
    };
  }

  // Moves what a dropped drag snapped or routed along onto the unsimplified lines, or else the
  // edit saves the simplified ones.
  private refineDrag(drag: LineDrag): Promise<void> {
    if (drag.kind === 'reroute') {
      const route = drag.query.latest;
      if (!route) {
        return Promise.resolve();
      }

      const refs = traceRefs(route);
      return this.refiner.load(refs).then(() => {
        const geometry = (ref: LineRef) => this.refiner.geometry(ref);
        drag.refined = refine(route, geometry).points;
      });
    }

    const snapped = drag.query.latest;
    const line = snapped?.line;
    if (!snapped || !line || this.shift.held) {
      return Promise.resolve();
    }
    return this.refiner.load([line]).then(() => {
      const fine = this.refiner.geometry(line);
      drag.refined = fine ? nearestOn(snapped.point[0], snapped.point[1], fine) : undefined;
    });
  }

  // Writes where the vertex is drawn into its points. It waits for its snap instead of jumping
  // between the pointer and the line, and keeps snapping while shift is down so that releasing it
  // lands on a fresh answer.
  private placeVertex(drag: VertexDrag): void {
    const at = this.shift.held ? drag.pointer : drag.refined ?? drag.query.latest?.point;
    if (drag.phase !== 'pressed' && at) {
      drag.points[2 * drag.index] = at[0];
      drag.points[2 * drag.index + 1] = at[1];
    }
  }

  private redrawOverlay<T>(value: T): T {
    this.overlay.generation += 1;
    return value;
  }

  // The line from its start through via to its end, along the lines in the index. A half that
  // finds no route is straight, like a segment drawn with the line tool.
  private routeThrough(points: Float64Array, via: Vec2): Promise<Traced> {
    const last = points.length - 2;
    const start: Vec2 = [points[0], points[1]];
    const end: Vec2 = [points[last], points[last + 1]];
    const radius = SNAP_RADIUS_PX * this.camera.inverseWorldRadius;
    // A reach of the diagonal of the line's bound, with via in it, lets the route stray as far as
    // the line already did.
    let lowX = via[0];
    let lowY = via[1];
    let highX = via[0];
    let highY = via[1];
    for (let i = 0; i < points.length; i += 2) {
      lowX = Math.min(lowX, points[i]);
      lowY = Math.min(lowY, points[i + 1]);
      highX = Math.max(highX, points[i]);
      highY = Math.max(highY, points[i + 1]);
    }
    const reach = Math.hypot(highX - lowX, highY - lowY);
    return Promise.all([
      this.locations.queryRoute(start, via, radius, reach),
      this.locations.queryRoute(via, end, radius, reach),
    ]).then(([a, b]) => joinRoutes(start, a, b, end));
  }

  // Ends a dropped line drag once its last query lands. A drag started since then owns the
  // layer's state, but the dropped one still applies.
  private settle(drag: LineDrag, source: EventSource): void {
    if (this.dragging === drag) {
      this.setDragging(undefined);
      this.geometry.generation += 1;
      this.overlay.generation += 1;
    }
    this.applyDrag(drag, source);
  }

  // Skipped when the line changed while the drag's query ran, like from an undo, because the query
  // was asked about the old geometry.
  private applyDrag(drag: LineDrag, source: EventSource): void {
    const live = this.store.get(drag.line.feature.id);
    if (live?.kind !== 'line' || live.latLngE7 !== drag.line.latLngE7) {
      return;
    }

    if (drag.kind === 'reroute') {
      const traced = drag.query.latest?.points;
      const points = drag.refined ?? (traced && Float64Array.from(traced));
      const after = points && rerouteLine(live, toE7Array(points));
      if (after) {
        source.trigger(FEATURE_EDITED, {before: snapshot(live), after});
      }
      return;
    }

    // Where the vertex is drawn, which is snapped, rather than where the pointer let go
    this.placeVertex(drag);
    const placed = unprojectS2LatLng(drag.points[2 * drag.index], drag.points[2 * drag.index + 1]);
    const latE7 = Math.round(placed.latDegrees() * 1e7);
    const lngE7 = Math.round(placed.lngDegrees() * 1e7);
    const after =
        drag.kind === 'vertex'
            ? moveVertex(live, drag.index, latE7, lngE7)
            : insertVertex(live, drag.index, latE7, lngE7);
    source.trigger(FEATURE_EDITED, {before: snapshot(live), after, vertex: drag.index});
  }

  // Reports what was hit and where, which the viewer selects so that its menu is plainly about
  // it.
  private contextClick(
      point: S2LatLng, at: Vec2, px: [number, number], source: EventSource): void {
    const editing = this.editingLine();
    const vertex = editing && this.vertexAt(editing.points, at);
    const hit = vertex !== undefined ? editing!.feature : this.hitTest(at);
    let spot: LineSpot|undefined = undefined;
    if (vertex !== undefined) {
      spot = {kind: 'vertex', index: vertex, handle: true};
    } else if (hit?.kind === 'line' && !isMarker(hit)) {
      spot = this.spotOn(this.projected.get(hit.id)!, at);
    }

    if (hit?.id !== this.editing) {
      this.stopEditing();
    }
    source.trigger(FEATURE_CONTEXT_MENU, {
      id: hit?.id,
      spot,
      latE7: Math.round(point.latDegrees() * 1e7),
      lngE7: Math.round(point.lngDegrees() * 1e7),
      px,
    });
  }

  // Where on the line at is nearest. A spot at either end of a segment is that vertex, or else
  // splitting there would put two vertices in the same place.
  private spotOn(line: ProjectedLine, at: Vec2): LineSpot|undefined {
    const nearest = nearestOnPolyline(line.points, at);
    if (!nearest) {
      return undefined;
    } else if (nearest.t <= 0) {
      return {kind: 'vertex', index: nearest.index - 1, handle: false};
    } else if (nearest.t >= 1) {
      return {kind: 'vertex', index: nearest.index, handle: false};
    }

    const ll = unprojectS2LatLng(nearest.at[0], nearest.at[1]);
    return {
      kind: 'segment',
      index: nearest.index,
      latE7: Math.round(ll.latDegrees() * 1e7),
      lngE7: Math.round(ll.lngDegrees() * 1e7),
    };
  }

  private pointsAt(at: Vec2): ProjectedPoint[] {
    const radius = (ICON_RADIUS_PX + CLICK_SLOP_PX) * this.camera.inverseWorldRadius;
    return this.visiblePoints.filter(
        point => Math.hypot(point.at[0] - at[0], point.at[1] - at[1]) <= radius);
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
    const radius = (lineRadius(line) + CLICK_SLOP_PX) * this.camera.inverseWorldRadius;
    const nearest = nearestOnPolyline(line.points, at);
    return nearest && nearest.distance <= radius ? nearest : undefined;
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
    const schema = this.store.schema();
    const lines = this.store.lines();
    const live = new Set<string>();
    this.visibleLines = [];
    for (const line of lines) {
      live.add(line.id);
      let projected = this.projected.get(line.id);
      if (!projected || projected.latLngE7 !== line.latLngE7) {
        const points = projectE7Array(line.latLngE7);
        projected = {
          feature: line,
          latLngE7: line.latLngE7,
          points,
          label: undefined,
          marker: undefined,
          look: lookOf(schema, line),
        };
        this.projected.set(line.id, projected);
      }
      projected.feature = line;
      projected.look = lookOf(schema, line);
      projected.marker = outlineOf(projected);
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
        const look = pointLook(schema, point.data);
        this.visiblePoints.push({
          feature: point,
          at: projectS2LatLng(S2LatLng.fromE7(point.latE7, point.lngE7)),
          look: {
            fill: parseColor(look.fill ?? DEFAULT_POINT_COLOR),
            icon: pointIcon(look.icon),
            label: look.label,
          },
        });
      }
    }

    this.publish();
    this.geometry.generation += 1;
    this.overlay.generation += 1;
    this.markers.generation += 1;
  }

  // Puts visible lines into the index so that drawing snaps onto them and routes along them. A
  // vertex that snapped onto a line's vertex sits on it exactly, since E7 round trips those
  // coordinates, and an end that snapped partway along a segment joins it within
  // DRAWN_TOLERANCE.
  //
  // Each line is its own group, keyed by its id, so that editing one line does not reproject
  // every other. Marker strokes are left out because a scribble is nothing to route along.
  //
  // The unindexed line is left out too, or else its vertex would snap onto the segments it is
  // leaving and its reroute would follow the way it already goes. A store change mid-drag, like
  // the DEM answering for the vertex placed before, republishes, so the exclusion lives here.
  private publish(): void {
    const unindexed = this.unindexed();
    const wanted = new Map<string, ProjectedLine>();
    for (const line of this.visibleLines) {
      if (!line.marker && line.feature.id !== unindexed) {
        wanted.set(line.feature.id, line);
      }
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
    const dragging = this.dragging;
    const dragged = dragging?.kind === 'point' ? dragging.point.id : dragging?.line.feature.id;
    const lines = this.visibleLines.filter(l => l.feature.id !== dragged && !l.marker);
    const selectedLine = lines.find(l => l.feature.id === this.selected);
    let needed = 0;
    for (const line of lines) {
      needed += LineProgram.bytesNeeded(line.points.length / 2);
    }
    if (selectedLine) {
      needed += LineProgram.bytesNeeded(selectedLine.points.length / 2);
    }

    const batch = new ShapeBatch(this.geometry, needed, this.renderer);
    for (const line of lines) {
      const {stroke, stipple} = line.look;
      batch.push(
          stroke, darken(stroke), lineRadius(line), line.points, Z_LINE, 'both', stipple);
    }
    if (selectedLine) {
      const {stroke, stipple} = selectedLine.look;
      batch.push(
          stroke,
          SELECTED_CASING,
          lineRadius(selectedLine) + 2,
          selectedLine.points,
          Z_SELECTED_LINE,
          'both',
          stipple);
    }
    batch.finish();
  }

  private planOverlay(): void {
    const dragging = this.dragging;
    const editing = this.editingLine();
    const vertexDrag =
        dragging?.kind === 'vertex' || dragging?.kind === 'insert' ? dragging : undefined;
    if (vertexDrag) {
      this.placeVertex(vertexDrag);
    }
    // The line as it is until the first route lands
    const reroute = dragging?.kind === 'reroute' ? dragging : undefined;
    const reroutePoints =
        reroute && (reroute.refined ?? reroute.query.latest?.points ?? reroute.line.points);
    const linePoints = vertexDrag ? vertexDrag.points : editing?.points;

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
    const hoveredLine = this.visibleLines.find(l => l.feature.id === hoveredId && !l.marker);
    const marker = this.marker;
    const grab = dragging ? undefined : this.grab;
    let needed =
        handleBytesNeeded(handles.length)
            + (hoveredLine ? LineProgram.bytesNeeded(hoveredLine.points.length / 2) : 0)
            + (marker ? LineProgram.bytesNeeded(2) : 0)
            + (grab ? LineProgram.bytesNeeded(2) : 0);
    if (vertexDrag) {
      needed += LineProgram.bytesNeeded(vertexDrag.points.length / 2);
    }
    if (reroutePoints) {
      needed += LineProgram.bytesNeeded(reroutePoints.length / 2);
    }

    const batch = new ShapeBatch(this.overlay, needed, this.renderer);
    if (hoveredLine) {
      const {stroke, stipple} = hoveredLine.look;
      batch.push(
          stroke,
          HOVERED_CASING,
          lineRadius(hoveredLine) + 2,
          hoveredLine.points,
          Z_SELECTED_LINE,
          'both',
          stipple);
    }
    if (vertexDrag) {
      const line = vertexDrag.line;
      batch.push(
          line.look.stroke,
          SELECTED_CASING,
          lineRadius(line) + 2,
          vertexDrag.points,
          Z_DRAGGED,
          'both',
          line.look.stipple);
    }
    if (reroute && reroutePoints) {
      const line = reroute.line;
      batch.push(
          line.look.stroke,
          SELECTED_CASING,
          lineRadius(line) + 2,
          reroutePoints,
          Z_DRAGGED,
          'both',
          line.look.stipple);
    }
    batch.pushHandles(handles, Z_HANDLE, this.handleTexture);
    if (marker) {
      // A zero length segment, which the cap program draws as a circle
      batch.push(
          HANDLE_COLOR,
          MARKER_STROKE,
          MARKER_RADIUS_PX,
          [marker[0], marker[1], marker[0], marker[1]],
          Z_HANDLE,
          'caps');
    }
    if (grab) {
      const color = grab.line.look.stroke;
      const [x, y] = grab.at;
      batch.push(GRAB_FILL, darken(color), GRAB_RADIUS_PX, [x, y, x, y], Z_HANDLE, 'caps');
    }
    batch.finish();
  }

  private planMarkers(): void {
    const dragging = this.dragging?.kind === 'marker' ? this.dragging : undefined;
    const strokes = this.visibleLines.filter(l => l.marker);
    let needed = 0;
    for (const line of strokes) {
      needed += LineProgram.bytesNeeded(line.marker!.outline.points.length / 2);
    }

    const worldRadius = this.camera.worldRadius;
    const batch = new ShapeBatch(this.markers, needed, this.renderer);
    for (const line of strokes) {
      const outline = line.marker!.outline;
      const id = line.feature.id;
      const color = line.look.stroke;
      if (id === dragging?.line.feature.id) {
        const moved = {...outline, points: translate(outline.points, dragging.by)};
        batch.pushMarker(color, SELECTED_CASING, moved, 2, worldRadius, Z_DRAGGED);
      } else if (id === this.selected) {
        batch.pushMarker(color, SELECTED_CASING, outline, 2, worldRadius, Z_SELECTED_LINE);
      } else if (id === this.hovered) {
        batch.pushMarker(color, HOVERED_CASING, outline, 2, worldRadius, Z_SELECTED_LINE);
      } else {
        batch.pushMarker(color, color, outline, 0, worldRadius, Z_LINE);
      }
    }
    batch.finish();
  }

  private planLabels(zoom: number): void {
    const labeled: Array<{graphemes: string[]; line?: ProjectedLine; point?: ProjectedPoint}> = [];
    const icons: Array<{graphemes: string[]; point: ProjectedPoint}> = [];
    const dragging = this.dragging?.kind === 'point' ? this.dragging : undefined;
    // A dragged point's icon and label follow the pointer.
    const at = (point: ProjectedPoint) =>
        point.feature.id === dragging?.point.id ? dragging.at : point.at;
    let needed = 0;
    for (const line of this.visibleLines) {
      const label = line.look.label;
      if (label) {
        const graphemes = toGraphemes(label);
        needed += GLYPHER.bytesNeeded(graphemes);
        labeled.push({graphemes, line});
      }
    }
    for (const point of this.visiblePoints) {
      const label = point.look.label;
      if (label) {
        const graphemes = wrap(toGraphemes(label), LABEL_LINE_GRAPHEMES);
        needed += GLYPHER.bytesNeeded(graphemes);
        labeled.push({graphemes, point});
      }
      const graphemes = toGraphemes(point.look.icon);
      needed += GLYPHER.bytesNeeded(graphemes);
      icons.push({graphemes, point});
    }
    this.labels = growBuffer(this.labels, needed);

    // Pixels per mercator unit, see mbtile_layer.ts#render.
    const pixelsPerWorld = 256 * Math.pow(2, zoom - 1);
    const drawables = [];
    let offset = 0;
    this.labelsMissingGlyphs = false;
    for (const {graphemes, point} of icons) {
      if (!GLYPHER.measurePx(graphemes, ICON_SCALE)) {
        this.labelsMissingGlyphs = true;
        continue;
      }

      const planned =
          GLYPHER.plan(
              graphemes,
              at(point),
              /* offsetPx= */ [0, 0],
              this.iconScale(point),
              /* angle= */ 0,
              point.look.fill,
              LABEL_STROKE,
              Z_LABEL,
              this.labels,
              offset,
              this.glLabels,
              this.renderer,
              {horizontal: 'center', vertical: 'middle'});
      drawables.push(...planned.drawables);
      offset += planned.byteSize;
    }
    for (const {graphemes, line, point} of labeled) {
      if (!GLYPHER.measurePx(graphemes, LABEL_SCALE)) {
        this.labelsMissingGlyphs = true;
        continue;
      }

      if (point) {
        const planned =
            GLYPHER.plan(
                graphemes,
                at(point),
                // Beside the icon, however big it is drawn
                [LABEL_GAP_PX + ICON_RADIUS_PX * this.iconScale(point) / ICON_SCALE, 0],
                LABEL_SCALE,
                /* angle= */ 0,
                LABEL_FILL,
                LABEL_STROKE,
                Z_LABEL,
                this.labels,
                offset,
                this.glLabels,
                this.renderer,
                {horizontal: 'start', vertical: 'middle'});
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

  // Caps alone draw a circle at every vertex.
  push(
      fill: RgbaU32,
      stroke: RgbaU32,
      radius: number,
      points: ArrayLike<number>,
      z: number,
      joins: 'line'|'caps'|'both',
      stipple: Stipple = false): void {
    const result =
        LineProgram.push(fill, stroke, radius, stipple, points, this.plan.buffer, this.offset);
    this.add(result, z, joins);
  }

  pushMarker(
      fill: RgbaU32,
      stroke: RgbaU32,
      outline: MarkerOutline,
      extraPx: number,
      worldRadius: number,
      z: number): void {
    const result =
        pushMarker(
            fill, stroke, outline, extraPx, worldRadius, this.plan.buffer, this.offset);
    this.add(result, z, 'both');
  }

  finish(): void {
    if (this.offset > 0) {
      this.renderer.uploadData(this.plan.buffer, this.offset, this.plan.glBuffer);
    }
    this.plan.drawables = this.drawables;
  }

  private add(
      result: ReturnType<typeof LineProgram.push>, z: number, joins: 'line'|'caps'|'both'): void {
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

// Returns the nearest spot on a polyline to at, with the index of the vertex ending its segment and
// how far along that segment it is, from 0 to 1.
function nearestOnPolyline(points: Float64Array, at: Vec2):
    {index: number; t: number; at: Vec2; distance: number}|undefined {
  let found = undefined;
  let best = Infinity;
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
      found = {index: i, t, at: [x, y] as Vec2, distance};
    }
  }
  return found;
}

// Keeps the last outline while the stroke's width and zoom are unchanged, since a new latLngE7
// makes a new ProjectedLine.
function outlineOf(line: ProjectedLine): ProjectedLine['marker'] {
  const zoom = line.feature.data.marker_zoom;
  if (zoom === undefined) {
    return undefined;
  }

  const widthPx = line.look.widthPx;
  if (line.marker?.widthPx === widthPx && line.marker.zoom === zoom) {
    return line.marker;
  }
  return {widthPx, zoom, outline: outlineMarker(line.points, widthPx, 1 / worldRadiusAt(zoom))};
}

// The routes from start to via and from via to end laid end to end, including where each snapped
// onto the lines. A route that missed every line has no via and so goes straight.
function joinRoutes(start: Vec2, a: Route, b: Route, end: Vec2): Traced {
  const trace = emptyTrace();
  pushPoint(trace, start, undefined, undefined);
  appendRoute(trace, a);
  appendRoute(trace, b);
  pushPoint(trace, end, undefined, undefined);
  return trace;
}

function isLineDrag(drag: Drag|undefined): drag is LineDrag {
  return drag?.kind === 'vertex' || drag?.kind === 'insert' || drag?.kind === 'reroute';
}

function translate(points: Float64Array, by: Vec2): Float64Array {
  const moved = new Float64Array(points.length);
  for (let i = 0; i < points.length; i += 2) {
    moved[i] = points[i] + by[0];
    moved[i + 1] = points[i + 1] + by[1];
  }
  return moved;
}

function lineRadius(line: ProjectedLine): number {
  return line.look.widthPx / 2 + CASING_PX;
}

// A marker stroke's default width differs from a line's.
function lookOf(schema: CollectionSchema, line: EditableLine): ProjectedLine['look'] {
  const look = lineLook(schema, line);
  return {
    label: look.label,
    stipple: toStipple(look.pattern),
    stroke: parseColor(look.stroke ?? DEFAULT_LINE_COLOR),
    widthPx: look.widthPx ?? (isMarker(line) ? DEFAULT_MARKER_WIDTH_PX : DEFAULT_WIDTH_PX),
  };
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

/** Parses #rrggbb, which is opaque, or #rrggbbaa. */
export function parseColor(hex: string): RgbaU32 {
  const value = parseInt(hex.slice(1), 16);
  if (Number.isNaN(value)) {
    return 0x000000FF as RgbaU32;
  }
  return (hex.length === 9 ? value >>> 0 : ((value << 8) | 0xFF) >>> 0) as RgbaU32;
}

function darken(color: RgbaU32): RgbaU32 {
  const r = Math.round(((color >>> 24) & 0xFF) * 0.4);
  const g = Math.round(((color >>> 16) & 0xFF) * 0.4);
  const b = Math.round(((color >>> 8) & 0xFF) * 0.4);
  return ((r << 24) | (g << 16) | (b << 8) | (color & 0xFF)) >>> 0 as RgbaU32;
}
