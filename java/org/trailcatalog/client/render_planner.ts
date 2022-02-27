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
    colorFill: Vec4;
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

  addLines(lines: ArrayBuffer[], colorFill: Vec4): void {
    const vertices = new Float32Array(this.geometry, this.geometryByteSize);
    let vertexOffset = 0;
    for (const line of lines) {
      const doubles = new Float64Array(line);

      this.target.lines.push({
        offset: this.geometryByteSize + 4 * vertexOffset,
        count: doubles.length / 2 - 1,
        colorFill: [1, 1, 1, 1],
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
        ], vertexOffset);
        vertexOffset += 5;
      }
    }

    this.geometryByteSize += 4 * vertexOffset;
  }
}

