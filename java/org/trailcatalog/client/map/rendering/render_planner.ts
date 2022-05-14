import { checkExists } from '../../common/asserts';
import { Vec2, Vec4 } from '../../common/types';
import { Camera } from '../models/camera';

import { BillboardProgram } from './billboard_program';
import { LineProgram } from './line_program';
import { Drawable } from './program';
import { Renderer } from './renderer';

export interface Line {
  colorFill: Vec4;
  colorStroke: Vec4;
  vertices: Float64Array;
}

const MAX_GEOMETRY_BYTES = 28_000_000;

export class RenderPlanner {

  private readonly drawables: Drawable[];
  private readonly geometry: ArrayBuffer;
  private readonly geometryBuffer: WebGLBuffer;
  private geometryByteSize: number;

  private readonly billboardProgram: BillboardProgram;
  private readonly lineProgram: LineProgram;

  constructor(private area: Vec2, private readonly renderer: Renderer) {
    this.drawables = [];
    this.geometry = new ArrayBuffer(MAX_GEOMETRY_BYTES);
    this.geometryBuffer = renderer.createBuffer(MAX_GEOMETRY_BYTES);
    this.geometryByteSize = 0;

    this.billboardProgram = new BillboardProgram(renderer.gl);
    this.lineProgram = new LineProgram(renderer.gl);
  }

  clear(): void {
    this.drawables.length = 0;
    this.geometryByteSize = 0;
  }

  resize(area: Vec2): void {
    this.area = area;
  }

  save(): void {
    this.renderer.uploadGeometry(this.geometry, this.geometryByteSize, this.geometryBuffer);
    this.drawables.sort((a, b) => {
      if (a.z !== b.z) {
        return a.z - b.z;
      } else {
        return a.program.id - b.program.id;
      }
    });
  }

  render(camera: Camera): void {
    if (this.drawables.length === 0) {
      return;
    }

    this.renderer.uploadGeometry(this.geometry, this.geometryByteSize, this.geometryBuffer);
    let drawStart = this.drawables[0];
    let drawStartIndex = 0;
    for (let i = 1; i < this.drawables.length; ++i) {
      const drawable = this.drawables[i];
      if (drawStart.program === drawable.program) {
        continue;
      }

      drawStart.program.render(
          this.area, camera, this.drawables.slice(drawStartIndex, i));
      drawStart = drawable;
      drawStartIndex = i;
    }

    drawStart.program.render(
        this.area, camera, this.drawables.slice(drawStartIndex, this.drawables.length));
  }

  addBillboard(center: Vec2, offsetPx: Vec2, size: Vec2, texture: WebGLTexture, z: number): void {
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

    this.align(256);
    this.drawables.push({
      buffer: this.geometryBuffer,
      offset: this.geometryByteSize,
      program: this.billboardProgram,
      texture,
      z,
    });

    const vertices = new Float32Array(this.geometry, this.geometryByteSize);
    vertices.set([
      /* center= */ xF, xR, yF, yR,
      /* offsetPx= */ offsetPx[0], offsetPx[1],
      /* std140 padding= */ 0, 0,
      /* size= */ wF, wR, hF, hR,
    ]);
    this.geometryByteSize += 4 * 4 + 4 * 4 + 4 * 4;
    new Uint8Array(this.geometry, this.geometryByteSize).set([
        /* sizeIsPixels= */ size[0] >= 1 ? 1 : 0, // well this is sketchy
        0, // pad this bool out so that it doesn't get corrupted by old data
        0,
        0,
    ]);
    this.geometryByteSize += 1;
    this.align(256);
  }

  addLines(lines: Line[], z: number): void {
    const stride = 4 + 4 + 4 + 4 + 1 + 1;
    const vertices = new Float32Array(this.geometry, this.geometryByteSize);
    let vertexOffset = 0;
    for (const line of lines) {
      const doubles = line.vertices;
      let distanceAlong = 0;
      for (let i = 0; i < doubles.length - 2; i += 2) {
        const x = doubles[i + 0];
        const y = doubles[i + 1];
        const xp = doubles[i + 2];
        const yp = doubles[i + 3];

        const xF = Math.fround(x);
        const xR = x - xF;
        const yF = Math.fround(y);
        const yR = y - yF;
        const xpF = Math.fround(xp);
        const xpR = xp - xpF;
        const ypF = Math.fround(yp);
        const ypR = yp - ypF;

        vertices.set([
          xF, xR, yF, yR,
          xpF, xpR, ypF, ypR,
          ...line.colorFill,
          ...line.colorStroke,
          distanceAlong,
          3,
        ], vertexOffset);

        const dx = xp - x;
        const dy = yp - y;
        distanceAlong += Math.sqrt(dx * dx + dy * dy);
        vertexOffset += stride;
      }
    }

    this.drawables.push({
      buffer: this.geometryBuffer,
      instances: vertexOffset / stride,
      offset: this.geometryByteSize,
      program: this.lineProgram,
      z,
    });
    this.geometryByteSize += 4 * vertexOffset;
  }

  private align(alignment: number): void {
    this.geometryByteSize =
        Math.trunc((this.geometryByteSize + alignment - 1) / alignment) * alignment;
  }
}

