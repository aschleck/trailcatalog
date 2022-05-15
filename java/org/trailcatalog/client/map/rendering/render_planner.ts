import { checkExists } from '../../common/asserts';
import { Vec2, Vec4 } from '../../common/types';
import { Camera } from '../models/camera';

import { BillboardProgram } from './billboard_program';
import { Line } from './geometry';
import { LineCapProgram } from './line_cap_program';
import { LineProgram } from './line_program';
import { Drawable } from './program';
import { Renderer } from './renderer';

const MAX_GEOMETRY_BYTES = 28_000_000;

export class RenderPlanner {

  private readonly drawables: Drawable[];
  private readonly geometry: ArrayBuffer;
  private readonly geometryBuffer: WebGLBuffer;
  private geometryByteSize: number;

  private readonly billboardProgram: BillboardProgram;
  private readonly lineCapProgram: LineCapProgram;
  private readonly lineProgram: LineProgram;

  constructor(private area: Vec2, private readonly renderer: Renderer) {
    this.drawables = [];
    this.geometry = new ArrayBuffer(MAX_GEOMETRY_BYTES);
    this.geometryBuffer = renderer.createBuffer(MAX_GEOMETRY_BYTES);
    this.geometryByteSize = 0;

    this.billboardProgram = new BillboardProgram(renderer.gl);
    this.lineCapProgram = new LineCapProgram(renderer.gl);
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

  addLines(lines: Line[], radius: number, z: number): void {
    const vertices = new Float32Array(this.geometry, this.geometryByteSize);
    const drawable = this.lineProgram.plan(lines, radius, vertices);

    this.drawables.push({
      buffer: this.geometryBuffer,
      instances: drawable.instances,
      offset: this.geometryByteSize,
      program: this.lineCapProgram,
      z,
    }, {
      buffer: this.geometryBuffer,
      instances: drawable.instances,
      offset: this.geometryByteSize,
      program: this.lineProgram,
      z,
    });
    this.geometryByteSize += drawable.bytes;
  }

  private align(alignment: number): void {
    this.geometryByteSize =
        Math.trunc((this.geometryByteSize + alignment - 1) / alignment) * alignment;
  }
}

