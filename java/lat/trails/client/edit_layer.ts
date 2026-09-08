import { S2LatLng } from 'java/org/trailcatalog/s2';
import { Camera, projectE7Array, projectS2LatLng } from 'js/map/camera';
import { RgbaU32 } from 'js/map/common/types';
import { EventSource, Layer } from 'js/map/layer';
import { growBuffer } from 'js/map/rendering/buffers';
import { LineProgram } from 'js/map/rendering/line_program';
import { Planner } from 'js/map/rendering/planner';
import { Drawable } from 'js/map/rendering/program';
import { Renderer } from 'js/map/rendering/renderer';
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

/** Draws the collection being edited and turns clicks into its lines. */
export class EditLayer extends Layer {

  private readonly lines: EditableLine[];
  // The line under construction, its cursor vertex separate because it follows the pointer instead
  // of being a vertex somebody placed.
  private drawing: {latLngE7: number[]; cursorE7: [number, number]|undefined}|undefined;
  private readonly saved: Plan;
  private readonly pending: Plan;
  private tool: Tool;

  constructor(
      private readonly camera: Camera,
      private readonly renderer: Renderer,
      private readonly onLineDrawn: (line: EditableLine) => void,
  ) {
    super(/* copyright= */ []);
    this.lines = [];
    this.drawing = undefined;
    this.saved = this.createPlan(128 * 1024);
    // One line's worth, so the common case of drawing without an import fits without a realloc.
    this.pending = this.createPlan(8 * 1024);
    this.tool = 'pointer';
  }

  setTool(tool: Tool): void {
    if (tool === this.tool) {
      return;
    }

    this.tool = tool;
    this.drawing = undefined;
    this.pending.generation += 1;
  }

  /** Replaces everything the layer draws, for opening a collection or starting a new one. */
  setLines(lines: EditableLine[]): void {
    this.lines.length = 0;
    this.lines.push(...lines);
    this.drawing = undefined;
    this.saved.generation += 1;
    this.pending.generation += 1;
  }

  addLines(lines: EditableLine[]): void {
    this.lines.push(...lines);
    this.saved.generation += 1;
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

    const latE7 = Math.round(point.latDegrees() * 1e7);
    const lngE7 = Math.round(point.lngDegrees() * 1e7);
    if (this.drawing) {
      if (this.nearLastVertex(point)) {
        this.finish();
        return true;
      }

      this.drawing.latLngE7.push(latE7, lngE7);
    } else {
      this.drawing = {latLngE7: [latE7, lngE7], cursorE7: undefined};
    }

    this.pending.generation += 1;
    return true;
  }

  override hover(point: S2LatLng, source: EventSource): boolean {
    if (this.tool !== 'line') {
      return false;
    }

    if (this.drawing) {
      this.drawing.cursorE7 =
          [Math.round(point.latDegrees() * 1e7), Math.round(point.lngDegrees() * 1e7)];
      this.pending.generation += 1;
    }

    // The line tool owns the cursor even before the first vertex, or else the collection layer
    // highlights whatever the pointer crosses on the way to a click.
    return true;
  }

  override keyPressed(key: string, source: EventSource): boolean {
    if (!this.drawing) {
      return false;
    }

    if (key === 'Enter') {
      this.finish();
    } else if (key === 'Escape') {
      this.drawing = undefined;
      this.pending.generation += 1;
    } else if (key === 'Backspace' || key === 'Delete') {
      const points = this.drawing.latLngE7;
      points.length = Math.max(0, points.length - 2);
      if (points.length === 0) {
        this.drawing = undefined;
      }
      this.pending.generation += 1;
    } else {
      return false;
    }
    return true;
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

  private finish(): void {
    const drawing = this.drawing;
    this.drawing = undefined;
    this.pending.generation += 1;
    if (!drawing || distinctPointCount(drawing.latLngE7) < 2) {
      return;
    }

    const line = {
      id: crypto.randomUUID(),
      version: 0n,
      data: {},
      latLngE7: Int32Array.from(drawing.latLngE7),
      elevationCentimeters: undefined,
      timeSeconds: undefined,
    };
    this.lines.push(line);
    this.saved.generation += 1;
    this.onLineDrawn(line);
  }

  private nearLastVertex(point: S2LatLng): boolean {
    const drawing = this.drawing;
    if (!drawing) {
      return false;
    }

    const at = drawing.latLngE7.length - 2;
    const last = projectE7Array(Int32Array.of(drawing.latLngE7[at], drawing.latLngE7[at + 1]));
    const [x, y] = projectS2LatLng(point);
    const radius = FINISH_RADIUS_PX * this.camera.inverseWorldRadius;
    const dx = x - last[0];
    const dy = y - last[1];
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

    const points = [...drawing.latLngE7];
    if (drawing.cursorE7) {
      points.push(...drawing.cursorE7);
    }
    // Stipple pending lines
    return [{points: projectE7Array(Int32Array.from(points)), stipple: true}];
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

function distinctPointCount(latLngE7: number[]): number {
  let count = 0;
  for (let i = 0; i < latLngE7.length; i += 2) {
    if (i === 0 || latLngE7[i] !== latLngE7[i - 2] || latLngE7[i + 1] !== latLngE7[i - 1]) {
      count += 1;
    }
  }
  return count;
}
