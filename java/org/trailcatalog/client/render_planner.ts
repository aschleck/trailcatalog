import { Camera } from 'java/org/trailcatalog/client/camera';
import { checkExists, Vec2, Vec4 } from 'java/org/trailcatalog/client/support';

export interface RenderPlan {
  billboards: Array<{
    texture: string;
  }>;
  lines: Array<{
    offset: number;
    count: number;
  }>;
}

export class RenderPlanner {

  geometryByteSize: number;
  readonly target: RenderPlan;

  constructor(readonly geometry: ArrayBuffer) {
    this.geometryByteSize = 0;
    this.target = {
      billboards: [],
      lines: [],
    };
  }

  // TODO: z is currently implicit, terrible assumption

  addLines(lines: ArrayBuffer[]): void {
    const vertices = new Float32Array(this.geometry, this.geometryByteSize);
    let vertexOffset = 0;
    for (const line of lines) {
      const doubles = new Float64Array(line);
      this.target.lines.push({
        offset: vertexOffset / 4,
        count: doubles.length, // this math is cheeky
      });

      for (let i = 0; i < doubles.length; i += 2) {
        const x = doubles[i + 0];
        const xF = Math.fround(x);
        const xR = x - xF;
        const y = doubles[i + 1];
        const yF = Math.fround(y);
        const yR = y - yF;
        vertices.set([xF, xR, yF, yR, xF, xR, yF, yR], vertexOffset + i * 4);
      }
      vertexOffset += doubles.length * 4;

      // This is shady because we reverse the perpendiculars here. It would be safer to extend the
      // line, but that takes work. This will likely break under culling.
      const x = doubles[doubles.length - 4];
      const xF = Math.fround(x);
      const xR = x - xF;
      const y = doubles[doubles.length - 3];
      const yF = Math.fround(y);
      const yR = y - yF;
      vertices.set([xF, xR, yF, yR, xF, xR, yF, yR], vertexOffset);
      vertexOffset += 8;
    }

    this.geometryByteSize = 4 * vertexOffset;
  }
}

