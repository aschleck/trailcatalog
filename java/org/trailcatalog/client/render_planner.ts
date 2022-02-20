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
    const vertices = new Float64Array(this.geometry, this.geometryByteSize);
    let vertexOffset = 0;
    for (const line of lines) {
      const doubles = new Float64Array(line);
      this.target.lines.push({
        offset: vertexOffset / 2,
        count: doubles.length, // this math is cheeky
      });

      for (let i = 0; i < doubles.length; i += 2) {
        const x = doubles[i + 0];
        const y = doubles[i + 1];
        vertices.set([x, y, x, y], vertexOffset + i * 2);
      }
      vertexOffset += doubles.length * 2;

      // This is shady because we reverse the perpendiculars here. It would be safer to extend the
      // line, but that takes work. This will likely break under culling.
      const x = doubles[doubles.length - 4];
      const y = doubles[doubles.length - 3];
      vertices.set([x, y, x, y], vertexOffset);
      vertexOffset += 4;
    }

    this.geometryByteSize = 8 * vertexOffset;
  }
}

