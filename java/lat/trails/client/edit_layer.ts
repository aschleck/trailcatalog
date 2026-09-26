import { S2LatLng, S2LatLngRect } from 'java/org/trailcatalog/s2';
import { Camera, projectE7Array, projectS2LatLng, unprojectS2LatLng } from 'js/map/camera';
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

import { Data } from './workers/collection_loader';

/** What pointer tools are possible. */
export type Tool = 'pointer'|'line';

export interface EditableLine {
  id: string;
  // The collection version this line was last saved at (or 0 if unsaved)
  version: bigint;
  data: Data;
  latLngE7: Int32Array;
  elevationCentimeters: Int32Array|undefined;
  timeSeconds: BigInt64Array|undefined;
}

const DRAWN_FILL = 0xE8442EFF as RgbaU32;
const DRAWN_STROKE = 0x3A0D06FF as RgbaU32;
const DRAWN_RADIUS_PX = 2.5;
// The click radius from a vertex to count as finishing drawing a line.
const FINISH_RADIUS_PX = 8;
// How close the pointer has to come to a line to snap onto it. Wider than the collection layer
// hovers at because a vertex only has to reach a line, not name which one.
const SNAP_RADIUS_PX = 12;
// How far a drawn line may sit from where it was drawn, which is only the rounding to E7. That
// moves each axis by up to half a unit, and mercator stretches latitude by sec(lat), so this covers
// drawing up to 83 degrees north or south, where sec reaches 8:
// => hypot(0.5, 0.5 * 8) = 4.03 E7 units
// => 4.03e-7 degrees, over 180 degrees to the mercator unit
const DRAWN_TOLERANCE = 4.03e-7 / 180;

// Geometry and the drawables reading it, replanned only when generation moves past planned. The
// saved lines and the line under construction get one each because the pointer moves the cursor
// vertex on every mouse move, and reprojecting an imported GPX at that rate costs more than the
// second buffer does.
interface Plan {
  drawables: Drawable[];
  geometry: ArrayBuffer;
  glGeometry: WebGLBuffer;
  generation: number;
  planned: number;
}

interface Polyline {
  points: Float64Array;
  stipple: boolean;
}

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
}

/** Draws the collection being edited and turns clicks into its lines. */
export class EditLayer extends Layer {

  private readonly lines: EditableLine[];
  // Prefixed to everything this layer puts in the shared index
  private readonly producer: string;
  // The line under construction, its cursor vertex separate because it follows the pointer instead
  // of being a vertex somebody placed.
  private drawing: Drawing|undefined;
  private readonly saved: Plan;
  private readonly pending: Plan;
  // The cursor whose route is in flight. The pointer moves faster than a search runs, so the
  // cursor asks again once this lands rather than on every move, or else routes queue up in the
  // worker.
  private routingCursor: Vertex|undefined;
  // How far a route may stray from the line between its ends: half the viewport's shorter side, so
  // the detour stays on screen when the segment is centered.
  private reach: number;
  // Shift suspends the router, so a segment stays straight for as long as it is down.
  private shiftHeld: boolean;
  private tool: Tool;

  constructor(
      // What the line tool snaps and routes onto, and where drawn lines go so later ones can too
      private readonly locations: LocationIndex,
      private readonly camera: Camera,
      private readonly renderer: Renderer,
      private readonly onLineDrawn: (line: EditableLine) => void,
  ) {
    super(/* copyright= */ []);
    this.producer = locations.producer();
    this.lines = [];
    this.drawing = undefined;
    this.saved = this.createPlan(128 * 1024);
    // One line's worth, so the common case of drawing without an import fits without a realloc.
    this.pending = this.createPlan(8 * 1024);
    this.routingCursor = undefined;
    this.reach = 0;
    this.shiftHeld = false;
    this.tool = 'pointer';

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

  setTool(tool: Tool): void {
    if (tool === this.tool) {
      return;
    }

    this.tool = tool;
    this.clearDrawing();
    this.locations.setRouting(tool === 'line');
  }

  /** Replaces everything the layer draws, for opening a collection or starting a new one. */
  setLines(lines: EditableLine[]): void {
    this.unpublishLines();
    this.lines.length = 0;
    this.lines.push(...lines);
    this.clearDrawing();
    this.saved.generation += 1;
    this.publishLines(this.lines);
  }

  addLines(lines: EditableLine[]): void {
    this.lines.push(...lines);
    this.saved.generation += 1;
    this.publishLines(lines);
  }

  override click(
      point: S2LatLng, px: [number, number], contextual: boolean, source: EventSource): boolean {
    if (this.tool !== 'line') {
      return false;
    }

    if (contextual) {
      this.finish();
      return true;
    }

    const at = projectS2LatLng(point);
    if (this.drawing && this.nearLastVertex(at)) {
      this.finish();
      return true;
    }

    const drawing = this.drawing ?? {vertices: [], cursor: undefined};
    const cursor = drawing.cursor;
    const previous = drawing.vertices[drawing.vertices.length - 1];
    drawing.cursor = undefined;
    this.drawing = drawing;
    // Starting from the cursor's route keeps the segment from flashing straight until this one's
    // answer lands.
    const placed = cursor && same(cursor.at, at) ? {...cursor} : vertexAt(at);
    drawing.vertices.push(placed);
    this.resolve(placed, previous);
    this.pending.generation += 1;
    return true;
  }

  override hover(point: S2LatLng, source: EventSource): boolean {
    if (this.tool !== 'line') {
      return false;
    }

    const drawing = this.drawing;
    if (drawing) {
      const at = projectS2LatLng(point);
      if (!same(drawing.cursor?.at, at)) {
        this.setCursor(drawing, vertexAt(at));
      }
    }

    // The line tool owns the cursor even before the first vertex, or else the collection layer
    // highlights whatever the pointer crosses on the way to a click.
    return true;
  }

  override keyPressed(key: string, source: EventSource): boolean {
    const drawing = this.drawing;
    if (!drawing) {
      return false;
    }

    if (key === 'Enter') {
      this.finish();
    } else if (key === 'Escape') {
      this.clearDrawing();
    } else if (key === 'Backspace' || key === 'Delete') {
      drawing.vertices.pop();
      this.pending.generation += 1;
      if (drawing.vertices.length === 0) {
        this.clearDrawing();
      } else if (drawing.cursor) {
        // The cursor's segment starts from a different vertex, so it routes again.
        this.setCursor(drawing, vertexAt(drawing.cursor.at));
      }
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
    return this.saved.generation !== this.saved.planned
        || this.pending.generation !== this.pending.planned;
  }

  override render(planner: Planner): void {
    if (this.saved.generation !== this.saved.planned) {
      this.plan(
          this.saved,
          this.lines.map(line => ({points: projectE7Array(line.latLngE7), stipple: false})));
      this.saved.planned = this.saved.generation;
    }
    if (this.pending.generation !== this.pending.planned) {
      this.plan(this.pending, this.pendingPolylines());
      this.pending.planned = this.pending.generation;
    }

    planner.add(this.saved.drawables);
    planner.add(this.pending.drawables);
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
    this.pending.generation += 1;
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

  private clearDrawing(): void {
    if (!this.drawing) {
      return;
    }

    this.drawing = undefined;
    this.pending.generation += 1;
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
          this.pending.generation += 1;
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

  private finish(): void {
    const drawing = this.drawing;
    if (!drawing) {
      return;
    }

    const points = drawnPoints(drawing.vertices);
    this.clearDrawing();
    const latLngE7 = toE7Array(points);
    if (distinctPointCount(latLngE7) < 2) {
      return;
    }

    const line = {
      id: crypto.randomUUID(),
      version: 0n,
      data: {},
      latLngE7,
      elevationCentimeters: undefined,
      timeSeconds: undefined,
    };
    this.lines.push(line);
    this.saved.generation += 1;
    this.publishLines([line]);
    this.onLineDrawn(line);
  }

  // Puts drawn lines into the index so that later lines snap onto them and route along them. A
  // vertex that snapped onto a line's vertex sits on it exactly, since E7 round trips those
  // coordinates, and an end that snapped partway along a segment joins it within
  // DRAWN_TOLERANCE. The line under construction stays out, or else it would snap to itself.
  //
  // Each line is its own group, keyed by its id, so that drawing one line does not reproject
  // every other.
  private publishLines(lines: EditableLine[]): void {
    for (const line of lines) {
      const key = this.lineKey(line);
      this.locations.load(
          key, DRAWN_TOLERANCE, [{id: key, points: projectE7Array(line.latLngE7)}], []);
    }
  }

  private unpublishLines(): void {
    this.locations.unload(this.lines.map(line => this.lineKey(line)));
  }

  private lineKey(line: EditableLine): string {
    return `${this.producer}${line.id}`;
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

  private createPlan(byteLength: number): Plan {
    const glGeometry = this.renderer.createDataBuffer(byteLength);
    this.registerDisposer(() => {
      this.renderer.deleteBuffer(glGeometry);
    });
    return {
      drawables: [],
      geometry: new ArrayBuffer(byteLength),
      glGeometry,
      generation: 0,
      planned: -1,
    };
  }

  private pendingPolylines(): Polyline[] {
    const drawing = this.drawing;
    if (!drawing) {
      return [];
    }

    const points =
        drawnPoints(drawing.cursor ? [...drawing.vertices, drawing.cursor] : drawing.vertices);
    // Stipple pending lines
    return [{points, stipple: true}];
  }

  private plan(target: Plan, polylines: Polyline[]): void {
    let needed = 0;
    for (const polyline of polylines) {
      needed += LineProgram.bytesNeeded(polyline.points.length / 2);
    }
    target.geometry = growBuffer(target.geometry, needed);

    const drawables = [];
    let offset = 0;
    for (const polyline of polylines) {
      const result =
          LineProgram.push(
              DRAWN_FILL,
              DRAWN_STROKE,
              DRAWN_RADIUS_PX,
              polyline.stipple,
              polyline.points,
              target.geometry,
              offset);
      offset += result.geometryByteLength;
      if (result.instanceCount === 0) {
        continue;
      }

      const drawable = {
        elements: undefined,
        geometry: target.glGeometry,
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
      drawables.push(drawable);
      // Circles at the joins, or else a corner shows the gap between two unmitered rectangles.
      drawables.push({...drawable, program: this.renderer.lineCapProgram});
    }

    if (offset > 0) {
      this.renderer.uploadData(target.geometry, offset, target.glGeometry);
    }
    target.drawables = drawables;
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

function toE7Array(points: Float64Array): Int32Array {
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
