import { S2LatLng, S2LatLngRect } from 'java/org/trailcatalog/s2';
import { Camera, projectS2LatLng, unprojectS2LatLng } from 'js/map/camera';
import { Copyright, RgbaU32, Vec2 } from 'js/map/common/types';
import { EventSource, Layer } from 'js/map/layer';
import { growBuffer } from 'js/map/rendering/buffers';
import { LineProgram } from 'js/map/rendering/line_program';
import { Planner } from 'js/map/rendering/planner';
import { Drawable } from 'js/map/rendering/program';
import { Renderer } from 'js/map/rendering/renderer';
import { LocationIndex } from 'js/map/workers/location_index';
import { Z_EDITING } from 'js/map/z';

import { LINE_DRAWN, TOOL_REQUESTED } from './events';
import {
  createHandleTexture,
  HANDLE_COLOR,
  HANDLE_SIZE_PX,
  handleBytesNeeded,
  planHandles,
} from './handles';
import { LatestQuery } from './latest_query';
import {
  appendTrace,
  emptyTrace,
  pushPoint,
  Refined,
  refine,
  routeTrace,
  Traced,
  traceRefs,
} from './line_matching';
import { LineRefiner } from './line_refiner';
import { ShiftKey } from './shift_key';

// What finishing a drawing does. A line hands itself off to be saved and clears. A measurement
// stays on the map until the next click starts another, so that its numbers can still be read.
export type DrawingMode = 'line'|'measure';

/**
 * Finds a way between two mercator points, excluding both, or resolves undefined when there is
 * none.
 */
export type SegmentRouter = (from: Vec2, to: Vec2) => Promise<Float64Array|undefined>;

/** How the placed segments of a drawing with a SegmentRouter stand. */
export interface RouteStatus {
  routing: number;
  unroutable: number;
  failed: number;
}

// The click radius from a vertex to count as finishing drawing a line.
const FINISH_RADIUS_PX = 8;
// How close the pointer has to come to a line to snap onto it. Wider than the collection layer
// hovers at because a vertex only has to reach a line, not name which one.
export const SNAP_RADIUS_PX = 12;
// One segment's worth, so the common case of drawing a line fits without a realloc.
const INITIAL_BUFFER_BYTES = 8 * 1024;
const LINE_COLOR = HANDLE_COLOR;
// One pixel either side of the path, all of it casing, so the line is a plain 2 px stroke
const LINE_RADIUS_PX = 1;
const MARKER_RADIUS_PX = 6;
const MARKER_STROKE = 0xFFFFFFFF as RgbaU32;


// A vertex of the line under construction, with the path that reaches it from the vertex before.
// Held in mercator and converted to E7 only when the line is finished, because the cursor vertex
// changes on every pointer move and its route can run to thousands of points.
interface Vertex {
  // Where the pointer was. Queries ask about this rather than where the vertex sits, so that
  // routing again after shift or backspace snaps from what was clicked.
  at: Vec2;
  // The path from just past the previous vertex up to and including this one, whose last point is
  // where the vertex sits. That is at until a route snaps it onto a line.
  trace: Traced;
  // How a SegmentRouter answered for the segment reaching this vertex
  routed: 'routing'|'routed'|'unroutable'|'failed'|undefined;
  // The latest request to the SegmentRouter, so that an answer to one it replaced is dropped
  request: number;
}

const NO_POINTS = new Float64Array(0);

interface Drawing {
  vertices: Vertex[];
  // The vertex following the pointer, which a click copies into vertices
  cursor: Vertex|undefined;
  // A finished measurement, which the next click replaces rather than extends
  finished: boolean;
  // A finish waiting on the SegmentRouter, which goes through once no segment is routing, or else
  // the line would keep them straight.
  finishing: EventSource|undefined;
}

/** Turns clicks into a polyline that snaps and routes along the lines in the index. */
export class DrawingLayer extends Layer {

  private active: boolean;
  private drawing: Drawing|undefined;
  // A spot on the drawing to call out, like the one under the pointer on an elevation profile
  private marker: Vec2|undefined;
  private readonly glGeometry: WebGLBuffer;
  private readonly handleTexture: WebGLTexture;
  private geometry: ArrayBuffer;
  private drawables: Drawable[];
  // Moves whenever the drawing does, and planned catches up in render.
  private generation: number;
  private planned: number;
  private readonly cursorQuery: LatestQuery<Vertex, void>;
  // How far a route may stray from the line between its ends: half the viewport's shorter side, so
  // the detour stays on screen when the segment is centered.
  private reach: number;
  // Shift suspends the router, so a segment stays straight for as long as it is down.
  private readonly shift: ShiftKey;
  // A click drops the cursor until the next move, so this is what says the pointer is still here.
  private pointerOver: boolean;
  private routeRequests: number;
  // The last refine of the placed vertices, and the vertex traces and refiner version it was made
  // from, because points() runs on every pointer move and the placed part rarely changes.
  private refinedFrom: {traces: Traced[]; version: number; refined: Refined}|undefined;

  constructor(
      private readonly mode: DrawingMode,
      // What vertices snap and route onto
      private readonly locations: LocationIndex,
      // Swaps the simplified lines the drawing routed along for unsimplified ones
      private readonly refiner: LineRefiner,
      private readonly camera: Camera,
      private readonly renderer: Renderer,
      // Called whenever the drawing changes, including when a route lands after the input that
      // asked for it
      private readonly onChanged: () => void = () => {},
      // Credited only while the layer is active, for data a tool reads while it is in use
      private readonly activeCopyrights: Copyright[] = [],
      // Routes placed segments in place of the index, which then neither snaps nor routes. The
      // segment to the cursor stays straight because a search can take seconds.
      private readonly router: SegmentRouter|undefined = undefined,
  ) {
    super(/* copyright= */ []);
    this.active = false;
    this.drawing = undefined;
    this.marker = undefined;
    this.glGeometry = renderer.createDataBuffer(INITIAL_BUFFER_BYTES);
    this.registerDisposer(() => {
      renderer.deleteBuffer(this.glGeometry);
    });
    this.geometry = new ArrayBuffer(INITIAL_BUFFER_BYTES);
    this.handleTexture = createHandleTexture(renderer);
    this.registerDisposer(() => {
      renderer.deleteTexture(this.handleTexture);
    });
    this.drawables = [];
    this.generation = 0;
    this.planned = -1;
    this.cursorQuery = new LatestQuery(cursor => {
      const vertices = this.drawing?.vertices;
      return vertices ? this.resolve(cursor, vertices[vertices.length - 1]) : Promise.resolve();
    });
    this.reach = 0;
    this.shift = new ShiftKey(() => {
      this.shiftChanged();
    });
    this.registerDisposable(this.shift);
    this.pointerOver = false;
    this.routeRequests = 0;
    this.refinedFrom = undefined;
  }

  override get copyrights(): Copyright[] {
    return this.active ? this.activeCopyrights : [];
  }

  setMarker(at: Vec2|undefined): void {
    this.marker = at;
    // Not changed(), because the marker is not part of the drawing its listener measures
    this.generation += 1;
  }

  setActive(active: boolean): void {
    if (active === this.active) {
      return;
    }

    this.active = active;
    this.clear();
    if (!this.router) {
      this.locations.setRouting(active);
    }
  }

  /** Returns the placed vertices and the paths between them in mercator, without the cursor. */
  placedPoints(): Float64Array {
    return this.drawing ? this.refined(this.drawing.vertices).points : NO_POINTS;
  }

  /**
   * Whether the drawing is under way with the pointer over the map, so that points() reaches the
   * pointer.
   */
  followsPointer(): boolean {
    return this.pointerOver && !!this.drawing && !this.drawing.finished && !this.drawing.finishing;
  }

  /** Returns the drawn polyline in mercator, including the segment to the cursor. */
  points(): Float64Array {
    const drawing = this.drawing;
    if (!drawing) {
      return NO_POINTS;
    }

    const placed = this.refined(drawing.vertices).points;
    const cursor = drawing.cursor?.trace.points;
    if (!cursor) {
      return placed;
    }
    const points = new Float64Array(placed.length + cursor.length);
    points.set(placed);
    points.set(cursor, placed.length);
    return points;
  }

  /** Asks the SegmentRouter again for every placed segment, like after its limits change. */
  reroute(): void {
    const vertices = this.drawing?.vertices ?? [];
    for (let i = 1; i < vertices.length; ++i) {
      this.resolve(vertices[i], vertices[i - 1]);
    }
    this.changed();
  }

  routeStatus(): RouteStatus {
    const status = {routing: 0, unroutable: 0, failed: 0};
    for (const vertex of this.drawing?.vertices ?? []) {
      if (vertex.routed && vertex.routed !== 'routed') {
        status[vertex.routed] += 1;
      }
    }
    return status;
  }

  /** Drops the last vertex, and the drawing with it once none are left. */
  popVertex(): void {
    const drawing = this.drawing;
    if (!drawing) {
      return;
    }

    drawing.vertices.pop();
    drawing.finishing = undefined;
    if (drawing.vertices.length === 0) {
      this.clear();
      return;
    }

    this.changed();
    if (drawing.cursor) {
      // The cursor's segment starts from a different vertex, so it routes again.
      this.setCursor(drawing, vertexAt(drawing.cursor.at));
    }
  }

  clear(): void {
    if (!this.drawing) {
      return;
    }

    this.drawing = undefined;
    this.marker = undefined;
    this.changed();
  }

  override click(
      point: S2LatLng, px: [number, number], contextual: boolean, source: EventSource): boolean {
    if (!this.active) {
      return false;
    }

    if (this.drawing?.finishing) {
      return true;
    } else if (contextual) {
      this.finish(source);
      return true;
    }

    const at = projectS2LatLng(point);
    if (this.drawing && !this.drawing.finished && this.nearLastVertex(at)) {
      this.finish(source);
      return true;
    }

    const drawing =
        this.drawing && !this.drawing.finished
            ? this.drawing
            : {vertices: [], cursor: undefined, finished: false, finishing: undefined};
    const cursor = drawing.cursor;
    const previous = drawing.vertices[drawing.vertices.length - 1];
    drawing.cursor = undefined;
    this.drawing = drawing;
    // Starting from the cursor's route keeps the segment from flashing straight until this one's
    // answer lands.
    const placed = cursor && same(cursor.at, at) ? {...cursor} : vertexAt(at);
    drawing.vertices.push(placed);
    this.loadLines(placed);
    this.resolve(placed, previous);
    this.changed();
    return true;
  }

  override hover(point: S2LatLng, source: EventSource): boolean {
    if (!this.active) {
      return false;
    }

    this.pointerOver = true;
    const drawing = this.drawing;
    if (drawing && !drawing.finished && !drawing.finishing) {
      const at = projectS2LatLng(point);
      if (!same(drawing.cursor?.at, at)) {
        this.setCursor(drawing, vertexAt(at));
      }
    }

    // A drawing tool owns the cursor even before the first vertex, or else the layers below
    // highlight whatever the pointer crosses on the way to a click.
    return true;
  }

  // Drops the segment to the cursor, or else it stays pointing at wherever the pointer left.
  override hoverLost(source: EventSource): void {
    const wasOver = this.pointerOver;
    this.pointerOver = false;
    const drawing = this.drawing;
    if (!this.active || !drawing) {
      return;
    }

    if (drawing.cursor) {
      drawing.cursor = undefined;
      this.changed();
    } else if (wasOver) {
      // Nothing to draw again, but followsPointer changed.
      this.onChanged();
    }
  }

  override keyPressed(key: string, source: EventSource): boolean {
    if (!this.active) {
      return false;
    }

    const drawing = this.drawing;
    if (key === 'Escape') {
      if (drawing) {
        this.clear();
      } else {
        source.trigger(TOOL_REQUESTED, {tool: 'pointer'});
      }
      return true;
    }

    if (!drawing || drawing.finished || drawing.finishing) {
      return false;
    }

    if (key === 'Enter') {
      this.finish(source);
    } else if (key === 'Backspace' || key === 'Delete') {
      this.popVertex();
    } else {
      return false;
    }
    return true;
  }

  override viewportChanged(bounds: S2LatLngRect, zoom: number, fetchZoom: number): void {
    const low = projectS2LatLng(bounds.lo());
    const high = projectS2LatLng(bounds.hi());
    this.reach = Math.min(Math.abs(high[0] - low[0]), Math.abs(high[1] - low[1])) / 2;
  }

  override hasNewData(): boolean {
    return this.generation !== this.planned;
  }

  override render(planner: Planner): void {
    if (this.generation !== this.planned) {
      this.plan();
      this.planned = this.generation;
    }
    planner.add(this.drawables);
  }

  private changed(): void {
    this.generation += 1;
    this.onChanged();
  }

  private shiftChanged(): void {
    const drawing = this.drawing;
    if (drawing?.cursor) {
      // A fresh cursor is straight until the router answers, which is what shift asks for and a
      // placeholder once it comes up.
      this.setCursor(drawing, vertexAt(drawing.cursor.at));
    }
  }

  // Puts a vertex under the pointer and starts resolving it.
  private setCursor(drawing: Drawing, cursor: Vertex): void {
    drawing.cursor = cursor;
    this.changed();
    this.cursorQuery.set(cursor);
  }

  // Snaps a vertex onto the lines and routes to it from the vertex before. The first vertex of a
  // line has nothing to route from, so it only snaps.
  private resolve(vertex: Vertex, previous: Vertex|undefined): Promise<void> {
    if (this.router) {
      return this.resolveWithRouter(this.router, vertex, previous);
    } else if (this.shift.held) {
      return Promise.resolve();
    }

    const radius = SNAP_RADIUS_PX * this.camera.inverseWorldRadius;
    if (!previous) {
      return this.locations.querySnap(vertex.at, radius).then(snapped => {
        if (this.isDrawn(vertex)) {
          vertex.trace = emptyTrace();
          pushPoint(vertex.trace, snapped?.point ?? vertex.at, undefined, snapped?.line);
          this.loadLines(vertex);
          this.changed();
        }
      });
    }

    return this.locations
        .queryRoute(previous.at, vertex.at, radius, this.reach)
        .then(route => {
          // Answers still arrive for a cursor the pointer has left and for lines that were
          // finished or dropped, and applying one would replan for a vertex nobody draws.
          if (!this.isDrawn(vertex)) {
            return;
          }

          // The vertex moves to the route's snapped end and the way there becomes its trace. A
          // route the network could not find leaves the segment straight.
          vertex.trace = routeTrace(pointOf(previous), route);
          this.loadLines(vertex);
          this.changed();
        });
  }

  private resolveWithRouter(router: SegmentRouter, vertex: Vertex, previous: Vertex|undefined):
      Promise<void> {
    if (!previous || this.drawing?.cursor === vertex) {
      return Promise.resolve();
    }

    this.routeRequests += 1;
    const request = this.routeRequests;
    vertex.request = request;
    vertex.routed = 'routing';
    const answered = (via: Float64Array|undefined, routed: Vertex['routed']) => {
      if (!this.isDrawn(vertex) || vertex.request !== request) {
        return;
      }

      const trace = emptyTrace();
      for (let i = 0; i < (via?.length ?? 0); i += 2) {
        pushPoint(trace, [via![i], via![i + 1]], undefined, undefined);
      }
      pushPoint(trace, pointOf(vertex), undefined, undefined);
      vertex.trace = trace;
      vertex.routed = routed;
      this.changed();
      const finishing = this.drawing?.finishing;
      if (finishing && this.routeStatus().routing === 0) {
        this.finish(finishing);
      }
    };
    return router(pointOf(previous), pointOf(vertex)).then(
        via => {
          answered(via, via ? 'routed' : 'unroutable');
        },
        e => {
          console.error(e);
          answered(undefined, 'failed');
        });
  }

  private isDrawn(vertex: Vertex): boolean {
    const drawing = this.drawing;
    return !!drawing && (drawing.cursor === vertex || drawing.vertices.includes(vertex));
  }

  // Fetches the unsimplified lines under a placed vertex's segment, and draws again once they land.
  private loadLines(vertex: Vertex): void {
    if (this.router || !this.drawing?.vertices.includes(vertex)) {
      return;
    }

    const refs = traceRefs(vertex.trace);
    if (refs.length > 0) {
      this.refiner.load(refs).then(() => {
        if (this.isDrawn(vertex)) {
          this.changed();
        }
      });
    }
  }

  private refined(vertices: Vertex[]): Refined {
    const traces = vertices.map(v => v.trace);
    const version = this.refiner.version;
    const held = this.refinedFrom;
    if (
        held
            && held.version === version
            && held.traces.length === traces.length
            && held.traces.every((trace, i) => trace === traces[i])) {
      return held.refined;
    }

    const trace = drawnTrace(vertices);
    let refined;
    if (this.router) {
      // A SegmentRouter's routes follow no lines.
      const points = Float64Array.from(trace.points);
      refined = {points, at: Uint32Array.from({length: points.length / 2}, (_, i) => i)};
    } else {
      refined = refine(trace, ref => this.refiner.geometry(ref));
    }
    this.refinedFrom = {traces, version, refined};
    return refined;
  }

  private finish(source: EventSource): void {
    const drawing = this.drawing;
    if (!drawing || drawing.finished) {
      return;
    }

    if (this.mode === 'measure') {
      drawing.cursor = undefined;
      drawing.finished = true;
      this.changed();
      return;
    } else if (this.routeStatus().routing > 0) {
      drawing.cursor = undefined;
      drawing.finishing = source;
      this.changed();
      return;
    }

    // Waits on the unsimplified lines too, or else the line saves with the simplified ones.
    const refs = traceRefs(drawnTrace(drawing.vertices));
    if (!this.router && !refs.every(ref => this.refiner.settled(ref))) {
      drawing.cursor = undefined;
      drawing.finishing = source;
      this.changed();
      this.refiner.load(refs).then(() => {
        if (this.drawing === drawing && drawing.finishing === source) {
          this.finish(source);
        }
      });
      return;
    }

    const latLngE7 = toE7Array(this.refined(drawing.vertices).points);
    this.clear();
    if (distinctPointCount(latLngE7) >= 2) {
      source.trigger(LINE_DRAWN, {latLngE7});
    }
  }

  private nearLastVertex(point: Vec2): boolean {
    const drawing = this.drawing;
    if (!drawing) {
      return false;
    }

    const last = pointOf(drawing.vertices[drawing.vertices.length - 1]);
    const radius = FINISH_RADIUS_PX * this.camera.inverseWorldRadius;
    const dx = point[0] - last[0];
    const dy = point[1] - last[1];
    return dx * dx + dy * dy <= radius * radius;
  }

  private plan(): void {
    const drawing = this.drawing;
    if (!drawing) {
      this.drawables = [];
      return;
    }

    const points = this.points();
    const vertices = drawing.vertices;
    const at = this.refined(vertices).at;
    const marker = this.marker;
    this.geometry =
        growBuffer(
            this.geometry,
            LineProgram.bytesNeeded(points.length / 2)
                + LineProgram.bytesNeeded(2)
                + handleBytesNeeded(vertices.length));
    const drawables: Drawable[] = [];
    const line =
        LineProgram.push(
            LINE_COLOR,
            LINE_COLOR,
            LINE_RADIUS_PX,
            /* stipple= */ false,
            points,
            this.geometry,
            /* offset= */ 0);
    let offset = line.geometryByteLength;
    if (line.instanceCount > 0) {
      const drawable = {
        elements: undefined,
        geometry: this.glGeometry,
        geometryByteLength: line.geometryByteLength,
        geometryOffset: line.geometryOffset,
        instanced: {
          count: line.instanceCount,
        },
        program: this.renderer.lineProgram,
        texture: undefined,
        vertexCount: line.vertexCount,
        z: Z_EDITING,
      };
      // Circles at the joins, or else a corner shows the gap between two unmitered rectangles.
      drawables.push(drawable, {...drawable, program: this.renderer.lineCapProgram});
    }

    // Placed vertices are hollow squares, and the last one placed is filled.
    const handles =
        planHandles(
            vertexIndices(vertices).map((index, i) => ({
              at: [points[2 * at[index]], points[2 * at[index] + 1]] as Vec2,
              filled: i === vertices.length - 1,
              sizePx: HANDLE_SIZE_PX,
            })),
            Z_EDITING + 1,
            this.geometry,
            offset,
            this.glGeometry,
            this.handleTexture,
            this.renderer);
    drawables.push(...handles.drawables);
    offset += handles.byteSize;

    if (marker) {
      // A zero length segment, which the cap program draws as a circle
      const result =
          LineProgram.push(
              LINE_COLOR,
              MARKER_STROKE,
              MARKER_RADIUS_PX,
              /* stipple= */ false,
              [marker[0], marker[1], marker[0], marker[1]],
              this.geometry,
              offset);
      drawables.push({
        elements: undefined,
        geometry: this.glGeometry,
        geometryByteLength: result.geometryByteLength,
        geometryOffset: result.geometryOffset,
        instanced: {count: result.instanceCount},
        program: this.renderer.lineCapProgram,
        texture: undefined,
        vertexCount: result.vertexCount,
        z: Z_EDITING + 2,
      });
      offset += result.geometryByteLength;
    }

    if (offset > 0) {
      this.renderer.uploadData(this.geometry, offset, this.glGeometry);
    }
    this.drawables = drawables;
  }
}

// The vertices and the paths reaching them, laid end to end
function drawnTrace(vertices: Vertex[]): Traced {
  const trace = emptyTrace();
  for (const vertex of vertices) {
    appendTrace(trace, vertex.trace);
  }
  return trace;
}

// Where each vertex sits in what drawnTrace lays out, as a point index
function vertexIndices(vertices: Vertex[]): number[] {
  const indices = [];
  let at = -1;
  for (const vertex of vertices) {
    at += vertex.trace.points.length / 2;
    indices.push(at);
  }
  return indices;
}

function pointOf(vertex: Vertex): Vec2 {
  const points = vertex.trace.points;
  return [points[points.length - 2], points[points.length - 1]];
}

export function toE7Array(points: Float64Array): Int32Array {
  const latLngE7 = new Int32Array(points.length);
  for (let i = 0; i < points.length; i += 2) {
    const ll = unprojectS2LatLng(points[i], points[i + 1]);
    latLngE7[i] = Math.round(ll.latDegrees() * 1e7);
    latLngE7[i + 1] = Math.round(ll.lngDegrees() * 1e7);
  }
  return latLngE7;
}

function vertexAt(at: Vec2): Vertex {
  const trace = emptyTrace();
  pushPoint(trace, at, undefined, undefined);
  return {at, trace, routed: undefined, request: 0};
}

function same(a: Vec2|undefined, b: Vec2): boolean {
  return !!a && a[0] === b[0] && a[1] === b[1];
}

function distinctPointCount(latLngE7: Int32Array): number {
  let count = 0;
  for (let i = 0; i < latLngE7.length; i += 2) {
    if (i === 0 || latLngE7[i] !== latLngE7[i - 2] || latLngE7[i + 1] !== latLngE7[i - 1]) {
      count += 1;
    }
  }
  return count;
}
