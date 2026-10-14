import { RgbaU32 } from '../common/types';
import { Layer } from '../layer';
import { Planner } from '../rendering/planner';
import { Drawable } from '../rendering/program';
import { Renderer } from '../rendering/renderer';
import { TriangleProgram } from '../rendering/triangle_program';

// Tiles stop at mercator y = +/-1, which is +/-85.05 degrees, so past that we draw a flat fill.
// y = 3 is lat 89.998, and the rows bunch up near the tile edge because tanh(y * pi) does nearly
// all of its turning there.
const CAP_ROWS = [1, 1.02, 1.05, 1.1, 1.2, 1.4, 3];
// Enough that the cap's edge stays on the tiles' edge on the globe, since each segment is a chord
const CAP_COLUMNS = 128;

export interface Cap {
  fill: RgbaU32;
  z: number;
}

/** Fills each pole past the reach of Web Mercator tiles with one color. */
export class PolarCapLayer extends Layer {

  private readonly drawables: Drawable[];

  constructor(north: Cap, south: Cap, renderer: Renderer) {
    super([]);
    this.drawables = [];

    for (const [sign, cap] of [[1, north], [-1, south]] as const) {
      // x,y for each vertex
      const vertices = [];
      const rows = sign > 0 ? CAP_ROWS : [...CAP_ROWS].reverse();
      for (const y of rows) {
        for (let c = 0; c <= CAP_COLUMNS; ++c) {
          vertices.push(c / CAP_COLUMNS * 2 - 1, sign * y);
        }
      }

      // Rows run bottom to top in mercator for both caps, so every quad winds counterclockwise.
      const indices = [];
      const stride = CAP_COLUMNS + 1;
      for (let r = 0; r < rows.length - 1; ++r) {
        for (let c = 0; c < CAP_COLUMNS; ++c) {
          const a = r * stride + c;
          const b = a + stride;
          indices.push(a, a + 1, b + 1, a, b + 1, b);
        }
      }

      const geometry = new Float32Array(vertices);
      const geometryBuffer = new ArrayBuffer(4 + geometry.byteLength);
      const indexBuffer = new ArrayBuffer(4 * indices.length);
      const glGeometry = renderer.createDataBuffer(geometryBuffer.byteLength);
      const glIndex = renderer.createIndexBuffer(indexBuffer.byteLength);
      this.registerDisposer(() => {
        renderer.deleteBuffer(glGeometry);
        renderer.deleteBuffer(glIndex);
      });

      this.drawables.push(
          renderer.triangleProgram.plan(
              geometry,
              indices,
              cap.fill,
              cap.z,
              geometryBuffer,
              /* geometryOffset= */ 0,
              indexBuffer,
              /* indexOffset= */ 0,
              glGeometry,
              glIndex));
      renderer.uploadData(geometryBuffer, geometryBuffer.byteLength, glGeometry);
      renderer.uploadIndices(indexBuffer, indexBuffer.byteLength, glIndex);
    }
  }

  override render(planner: Planner): void {
    planner.add(this.drawables);
  }
}
