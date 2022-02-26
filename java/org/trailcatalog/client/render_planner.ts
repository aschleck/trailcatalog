import { Camera } from 'java/org/trailcatalog/client/camera';
import { checkExists, Vec2, Vec4 } from 'java/org/trailcatalog/client/support';

export interface RenderPlan {
  billboards: Array<{
    center: Vec4;
    size: Vec4;
    texture: WebGLTexture;
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

  addBillboard(center: Vec2, size: Vec2, texture: WebGLTexture): void {
    const x = center[0];
    const xF = Math.fround(x);
    const xR = x - xF;
    const y = center[1];
    const yF = Math.fround(y);
    const yR = y - yF;

    const w = size[0];
    const wF = Math.fround(w);
    const wR = w - wF;
    const h = size[1];
    const hF = Math.fround(h);
    const hR = h - hF;

    this.target.billboards.push({
      center: [xF, xR, yF, yR],
      size: [wF, wR, hF, hR],
      texture,
    });
  }

  addLines(lines: ArrayBuffer[]): void {
    const vertices = new Float32Array(this.geometry, this.geometryByteSize);
    let vertexOffset = 0;
    for (const line of lines) {
      const doubles = new Float64Array(line);
      this.target.lines.push({
        offset: vertexOffset / 5,
        count: doubles.length, // this math is cheeky
      });

      let distanceAlong = 0;
      let lastX = doubles[0];
      let lastY = doubles[1];
      for (let i = 0; i < doubles.length; i += 2) {
        const x = doubles[i + 0];
        const xF = Math.fround(x);
        const xR = x - xF;
        const y = doubles[i + 1];
        const yF = Math.fround(y);
        const yR = y - yF;

        const dx = x - lastX;
        const dy = y - lastY;
        distanceAlong += Math.sqrt(dx * dx + dy * dy);
        lastX = x;
        lastY = y;

        vertices.set([
          xF, xR, yF, yR, distanceAlong,
          xF, xR, yF, yR, distanceAlong,
        ], vertexOffset + i * 5);
      }
      vertexOffset += doubles.length * 5;

      // This is shady because we reverse the perpendiculars here. It would be safer to extend the
      // line, but that takes work. This will likely break under culling.
      const x = doubles[doubles.length - 4];
      const xF = Math.fround(x);
      const xR = x - xF;
      const y = doubles[doubles.length - 3];
      const yF = Math.fround(y);
      const yR = y - yF;
      vertices.set([
        xF, xR, yF, yR, 0, // distanceAlong doesn't matter here
        xF, xR, yF, yR, 0,
      ], vertexOffset);
      vertexOffset += 10;
    }

    this.geometryByteSize = 4 * vertexOffset;
  }
}

