import { Camera } from 'js/map/camera';
import { RgbaU32, Vec2 } from 'js/map/common/types';
import { Layer } from 'js/map/layer';
import { growBuffer } from 'js/map/rendering/buffers';
import { LineProgram } from 'js/map/rendering/line_program';
import { Planner } from 'js/map/rendering/planner';
import { Drawable } from 'js/map/rendering/program';
import { Renderer } from 'js/map/rendering/renderer';
import { Z_USER_DATA_HIGHLIGHT } from 'js/map/z';

// The hover highlight's colors, since a search result has no style of its own to keep
const FILL = 0xFFFFFFFF as RgbaU32;
const CASING = 0x000000FF as RgbaU32;

const LINE_RADIUS_PX = 4;
const OUTLINE_RADIUS_PX = 3;

// Outside the 28 pixel icon a hovered point draws, so the ring circles the icon instead of
// covering it
const RING_SIZE_PX = 17;
const RING_SEGMENTS = 32;

// With the selected objects of the other layers, under the hover highlight
const Z_SHAPE = Z_USER_DATA_HIGHLIGHT - 0.25;

type Shape = {
  kind: 'lines'|'outline';
  // Mercator
  runs: Array<ArrayLike<number>>;
}|{
  kind: 'point';
  // Mercator
  position: Vec2;
};

/**
 * Draws a search result picked from the box as selected. The collection layers only hold what is
 * near the camera at the zoom it loaded for, so a whole trail or park has to come from GetShape.
 */
export class ShapeLayer extends Layer {

  private readonly glGeometry: WebGLBuffer;
  private geometry: ArrayBuffer;
  private drawables: Drawable[];
  private shape: Shape|undefined;
  // A ring is sized in pixels, so it replans whenever the zoom moves.
  private plannedZoom: number;

  constructor(private readonly camera: Camera, private readonly renderer: Renderer) {
    super(/* copyright= */ []);
    this.glGeometry = renderer.createDataBuffer(64 * 1024);
    this.registerDisposer(() => {
      renderer.deleteBuffer(this.glGeometry);
    });
    this.geometry = new ArrayBuffer(64 * 1024);
    this.drawables = [];
    this.shape = undefined;
    this.plannedZoom = -1;
  }

  /** Draws a trail's lines, a boundary's outline, or a ring around a point, or else nothing. */
  setShape(shape: Shape|undefined): void {
    this.shape = shape;
    this.plannedZoom = -1;
    this.redraw();
  }

  override render(planner: Planner, zoom: number): void {
    if (zoom !== this.plannedZoom) {
      this.plan();
      this.plannedZoom = zoom;
    }
    planner.add(this.drawables);
  }

  private plan(): void {
    const shape = this.shape;
    this.drawables = [];
    if (!shape) {
      return;
    }

    const runs = shape.kind === 'point' ? [this.ringAround(shape.position)] : shape.runs;
    const radius = shape.kind === 'outline' ? OUTLINE_RADIUS_PX : LINE_RADIUS_PX;
    const bytes =
        runs.reduce((sum, run) => sum + LineProgram.bytesNeeded(run.length / 2), /* initial= */ 0);
    this.geometry = growBuffer(this.geometry, bytes);
    let offset = 0;
    for (const run of runs) {
      if (run.length < 4) {
        continue;
      }
      const drawable =
          this.renderer.lineProgram.plan(
              FILL,
              CASING,
              radius,
              /* pattern= */ 'solid',
              Z_SHAPE,
              run,
              this.geometry,
              offset,
              this.glGeometry);
      offset += drawable.geometryByteLength;
      this.drawables.push(drawable);
    }
    this.renderer.uploadData(this.geometry, offset, this.glGeometry);
  }

  private ringAround([x, y]: Vec2): Float64Array {
    const size = RING_SIZE_PX * this.camera.inverseWorldRadius;
    const ring = new Float64Array(2 * (RING_SEGMENTS + 1));
    for (let i = 0; i <= RING_SEGMENTS; ++i) {
      const angle = 2 * Math.PI * i / RING_SEGMENTS;
      ring[2 * i + 0] = x + size * Math.cos(angle);
      ring[2 * i + 1] = y + size * Math.sin(angle);
    }
    return ring;
  }
}
