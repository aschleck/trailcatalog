import { S2LatLng, S2LatLngRect } from 'java/org/trailcatalog/s2';
import { Camera, projectS2LatLng, unprojectS2LatLng } from 'js/map/camera';
import { RgbaU32, Vec2 } from 'js/map/common/types';
import { EventSource, Layer } from 'js/map/layer';
import { growBuffer } from 'js/map/rendering/buffers';
import { LineProgram } from 'js/map/rendering/line_program';
import { Planner } from 'js/map/rendering/planner';
import { Drawable } from 'js/map/rendering/program';
import { Renderer } from 'js/map/rendering/renderer';
import { LocationIndex } from 'js/map/workers/location_index';
import { Route } from 'js/map/workers/location_querier';
import { Z_EDITING } from 'js/map/z';

import { LINE_DRAWN, TOOL_REQUESTED } from './events';

export interface DrawingStyle {
  fill: RgbaU32;
  stroke: RgbaU32;
  radiusPx: number;
}

// What finishing a drawing does. A line hands itself off to be saved and clears. A measurement
// stays on the map until the next click starts another, so that its numbers can still be read.
export type DrawingMode = 'line'|'measure';

// The click radius from a vertex to count as finishing drawing a line.
const FINISH_RADIUS_PX = 8;
// How close the pointer has to come to a line to snap onto it. Wider than the collection layer
// hovers at because a vertex only has to reach a line, not name which one.
const SNAP_RADIUS_PX = 12;
// One segment's worth, so the common case of drawing a line fits without a realloc.
const INITIAL_BUFFER_BYTES = 8 * 1024;

// A vertex of the line under construction, with the path that reaches it from the vertex before.
// Held in mercator and converted to E7 only when the line is finished, because the cursor vertex
// changes on every pointer move and its route can run to thousands of points.
interface Vertex {
  // Where the pointer was. Queries ask about this rather than point, so that routing again after
  // shift or backspace snaps from what was clicked.
  at: Vec2;
  // Where the vertex sits, which is at until a route snaps it onto a line
  point: Vec2;
  // The path from the previous vertex to this one, excluding both, and empty for a straight
  // segment
  via: Float64Array;
}

// Shared because a straight segment is the common case and nothing writes through it.
const STRAIGHT = new Float64Array(0);

interface Drawing {
  vertices: Vertex[];
  // The vertex following the pointer, which a click copies into vertices
  cursor: Vertex|undefined;
  // A finished measurement, which the next click replaces rather than extends
  finished: boolean;
}

/** Turns clicks into a polyline that snaps and routes along the lines in the index. */
export class DrawingLayer extends Layer {

  private active: boolean;
  private drawing: Drawing|undefined;
  private readonly glGeometry: WebGLBuffer;
  private geometry: ArrayBuffer;
  private drawables: Drawable[];
  // Moves whenever the drawing does, and planned catches up in render.
  private generation: number;
  private planned: number;
  // The cursor whose route is in flight. The pointer moves faster than a search runs, so the
  // cursor asks again once this lands rather than on every move, or else routes queue up in the
  // worker.
  private routingCursor: Vertex|undefined;
  // How far a route may stray from the line between its ends: half the viewport's shorter side, so
  // the detour stays on screen when the segment is centered.
  private reach: number;
  // Shift suspends the router, so a segment stays straight for as long as it is down.
  private shiftHeld: boolean;

  constructor(
      private readonly mode: DrawingMode,
      private readonly style: DrawingStyle,
      // What vertices snap and route onto
      private readonly locations: LocationIndex,
      private readonly camera: Camera,
      private readonly renderer: Renderer,
      // Called whenever the drawing changes, including when a route lands after the input that
      // asked for it
      private readonly onChanged: () => void = () => {},
  ) {
    super(/* copyright= */ []);
    this.active = false;
    this.drawing = undefined;
    this.glGeometry = renderer.createDataBuffer(INITIAL_BUFFER_BYTES);
    this.registerDisposer(() => {
      renderer.deleteBuffer(this.glGeometry);
    });
    this.geometry = new ArrayBuffer(INITIAL_BUFFER_BYTES);
    this.drawables = [];
    this.generation = 0;
    this.planned = -1;
    this.routingCursor = undefined;
    this.reach = 0;
    this.shiftHeld = false;

    // Read from shiftKey rather than key, so that any keystroke corrects a missed shift release.
    this.registerListener(window, 'keydown', e => {
      this.setShiftHeld(e.shiftKey);
    });
    this.registerListener(window, 'keyup', e => {
      this.setShiftHeld(e.shiftKey);
    });
    // A shift released while another window has focus sends us no keyup.
    this.registerListener(window, 'blur', () => {
      this.setShiftHeld(false);
    });
  }

  setActive(active: boolean): void {
    if (active === this.active) {
      return;
    }

    this.active = active;
    this.clear();
    this.locations.setRouting(active);
  }

  /** Returns the drawn polyline in mercator, including the segment to the cursor. */
  points(): Float64Array {
    const drawing = this.drawing;
    if (!drawing) {
      return STRAIGHT;
    }
    return drawnPoints(drawing.cursor ? [...drawing.vertices, drawing.cursor] : drawing.vertices);
  }

  /** Drops the last vertex, and the drawing with it once none are left. */
  popVertex(): void {
    const drawing = this.drawing;
    if (!drawing) {
      return;
    }

    drawing.vertices.pop();
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
    this.changed();
  }

  override click(
      point: S2LatLng, px: [number, number], contextual: boolean, source: EventSource): boolean {
    if (!this.active) {
      return false;
    }

    if (contextual) {
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
            : {vertices: [], cursor: undefined, finished: false};
    const cursor = drawing.cursor;
    const previous = drawing.vertices[drawing.vertices.length - 1];
    drawing.cursor = undefined;
    this.drawing = drawing;
    // Starting from the cursor's route keeps the segment from flashing straight until this one's
    // answer lands.
    const placed = cursor && same(cursor.at, at) ? {...cursor} : vertexAt(at);
    drawing.vertices.push(placed);
    this.resolve(placed, previous);
    this.changed();
    return true;
  }

  override hover(point: S2LatLng, source: EventSource): boolean {
    if (!this.active) {
      return false;
    }

    const drawing = this.drawing;
    if (drawing && !drawing.finished) {
      const at = projectS2LatLng(point);
      if (!same(drawing.cursor?.at, at)) {
        this.setCursor(drawing, vertexAt(at));
      }
    }

    // A drawing tool owns the cursor even before the first vertex, or else the layers below
    // highlight whatever the pointer crosses on the way to a click.
    return true;
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

    if (!drawing || drawing.finished) {
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

  private setShiftHeld(held: boolean): void {
    if (held === this.shiftHeld) {
      return;
    }

    this.shiftHeld = held;
    const drawing = this.drawing;
    if (drawing?.cursor) {
      // A fresh cursor is straight until the router answers, which is what shift asks for and a
      // placeholder once it comes up.
      this.setCursor(drawing, vertexAt(drawing.cursor.at));
    }
  }

  // Puts a vertex under the pointer and starts resolving it unless another cursor already is.
  private setCursor(drawing: Drawing, cursor: Vertex): void {
    drawing.cursor = cursor;
    this.changed();
    if (!this.routingCursor) {
      this.routeCursor();
    }
  }

  private routeCursor(): void {
    const drawing = this.drawing;
    const cursor = drawing?.cursor;
    if (!drawing || !cursor) {
      return;
    }

    this.routingCursor = cursor;
    this.resolve(cursor, drawing.vertices[drawing.vertices.length - 1]).then(() => {
      this.routingCursor = undefined;
      if (this.drawing?.cursor !== cursor) {
        this.routeCursor();
      }
    });
  }

  // Snaps a vertex onto the lines and routes to it from the vertex before. The first vertex of a
  // line has nothing to route from, so it asks about itself and keeps only the snap.
  private resolve(vertex: Vertex, previous: Vertex|undefined): Promise<void> {
    if (this.shiftHeld) {
      return Promise.resolve();
    }

    const from = previous ?? vertex;
    return this.locations
        .queryRoute(
            from.at, vertex.at, SNAP_RADIUS_PX * this.camera.inverseWorldRadius, this.reach)
        .then(route => {
          // Answers still arrive for a cursor the pointer has left and for lines that were
          // finished or dropped, and applying one would replan for a vertex nobody draws.
          if (!this.isDrawn(vertex)) {
            return;
          }

          this.apply(vertex, previous, route);
          this.changed();
        });
  }

  private isDrawn(vertex: Vertex): boolean {
    const drawing = this.drawing;
    return !!drawing && (drawing.cursor === vertex || drawing.vertices.includes(vertex));
  }

  // Writes a route onto the vertex it was asked about. The vertex moves to the route's snapped
  // end and the way there becomes its via. A route the network could not find leaves the segment
  // straight.
  private apply(vertex: Vertex, previous: Vertex|undefined, route: Route): void {
    vertex.point = route.to;
    const via = route.via;
    if (!via) {
      vertex.via = STRAIGHT;
      return;
    }

    // route.from is the previous vertex snapped onto a line. When that vertex sits off the lines,
    // the segment has to reach route.from before it can follow the route.
    if (!previous || same(previous.point, route.from)) {
      vertex.via = via;
      return;
    }

    const withStart = new Float64Array(via.length + 2);
    withStart[0] = route.from[0];
    withStart[1] = route.from[1];
    withStart.set(via, 2);
    vertex.via = withStart;
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
    }

    const latLngE7 = toE7Array(drawnPoints(drawing.vertices));
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

    const last = drawing.vertices[drawing.vertices.length - 1].point;
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
    this.geometry = growBuffer(this.geometry, LineProgram.bytesNeeded(points.length / 2));
    const result =
        LineProgram.push(
            this.style.fill,
            this.style.stroke,
            this.style.radiusPx,
            // Stipple what is still being drawn
            /* stipple= */ !drawing.finished,
            points,
            this.geometry,
            /* offset= */ 0);
    if (result.instanceCount === 0) {
      this.drawables = [];
      return;
    }

    this.renderer.uploadData(this.geometry, result.geometryByteLength, this.glGeometry);
    const drawable = {
      elements: undefined,
      geometry: this.glGeometry,
      geometryByteLength: result.geometryByteLength,
      geometryOffset: result.geometryOffset,
      instanced: {
        count: result.instanceCount,
      },
      program: this.renderer.lineProgram,
      texture: undefined,
      vertexCount: result.vertexCount,
      z: Z_EDITING,
    };
    // Circles at the joins, or else a corner shows the gap between two unmitered rectangles.
    this.drawables = [drawable, {...drawable, program: this.renderer.lineCapProgram}];
  }
}

// The vertices and the paths reaching them, laid end to end, in mercator.
function drawnPoints(vertices: Vertex[]): Float64Array {
  let count = 0;
  for (const vertex of vertices) {
    count += vertex.via.length + 2;
  }

  const points = new Float64Array(count);
  let at = 0;
  for (const vertex of vertices) {
    points.set(vertex.via, at);
    at += vertex.via.length;
    points[at] = vertex.point[0];
    points[at + 1] = vertex.point[1];
    at += 2;
  }
  return points;
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
  return {at, point: at, via: STRAIGHT};
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
