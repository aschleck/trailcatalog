import * as arrays from 'js/common/arrays';
import { splitVec2 } from '../common/math';
import { RgbaU32, Vec2 } from '../common/types';
import { Camera } from '../models/camera';

import { BillboardProgram } from './billboard_program';
import { HypsometryProgram } from './hypsometry_program';
import { Line } from './geometry';
import { LineCapProgram } from './line_cap_program';
import { LineProgram } from './line_program';
import { Drawable } from './program';
import { Renderer } from './renderer';
import { Glyph, SdfProgram } from './sdf_program';
import { TriangleProgram } from './triangle_program';

export interface RenderBakerFactory {
  createChild(geometryByteSize: number, indexByteSize: number): RenderBaker;
}

export class RenderBaker {

  readonly drawables: Drawable[];
  private readonly geometry: ArrayBuffer;
  private geometryByteSize: number;
  private readonly index: ArrayBuffer;
  private indexByteSize: number;
  private lastIndexChecksum: number;

  constructor(
    private readonly billboardProgram: BillboardProgram,
    private readonly hypsometryProgram: HypsometryProgram,
    private readonly lineCapProgram: LineCapProgram,
    private readonly lineProgram: LineProgram,
    private readonly sdfProgram: SdfProgram,
    private readonly triangleProgram: TriangleProgram,
    geometryByteSize: number,
    indexByteSize: number) {
    this.drawables = [];
    this.geometry = new ArrayBuffer(geometryByteSize);
    this.geometryByteSize = 0;
    this.index = new ArrayBuffer(indexByteSize);
    this.indexByteSize = 0;
    this.lastIndexChecksum = 0;
  }

  clear(): void {
    this.drawables.length = 0;
    this.geometryByteSize = 0;
    this.indexByteSize = 0;
  }

  createChild(geometryByteSize: number, indexByteSize: number): RenderBaker {
    return new RenderBaker(
        this.billboardProgram,
        this.hypsometryProgram,
        this.lineCapProgram,
        this.lineProgram,
        this.sdfProgram,
        this.triangleProgram,
        geometryByteSize,
        indexByteSize);
  }

  upload(renderer: Renderer, geometryGl: WebGLBuffer, indexGl: WebGLBuffer): [boolean, boolean] {
    if (this.drawables.length === 0) {
      return [false, false];
    }

    this.drawables.sort((a, b) => {
      if (a.z !== b.z) {
        return a.z - b.z;
      } else if (a.program.id !== b.program.id) {
        return a.program.id - b.program.id;
      } else {
        return a.geometryOffset - b.geometryOffset;
      }
    });

    let drawStart = this.drawables[0];
    const compressed = [drawStart];
    // Gather sequential drawables that share the same program and draw them all at once
    for (let i = 1; i < this.drawables.length; ++i) {
      const drawable = this.drawables[i];
      if (drawStart.program === drawable.program
            && drawStart.instanced && drawable.instanced
            && drawStart.texture === drawable.texture
            && drawStart.geometryOffset + drawStart.instanced.bytes
                === drawable.geometryOffset) {
        drawStart.instanced.bytes += drawable.instanced.bytes;
        drawStart.instanced.count += drawable.instanced.count;
        continue;
      }

      compressed.push(drawable);
      drawStart = drawable;
    }

    this.drawables.length = 0;
    arrays.pushInto(this.drawables, compressed);

    renderer.uploadData(this.geometry, this.geometryByteSize, geometryGl);

    // Uploading indices is very slow because WebGL does bounds checking. So calculate a simple
    // checksum to hopefully avoid it.
    let checksum = 0;
    const indexUint32s = new Uint32Array(this.index, 0, this.indexByteSize / 4);
    for (let i = 0; i < indexUint32s.length; ++i) {
      checksum = (31 * checksum + indexUint32s[i]) | 0;
    }

    if (checksum !== this.lastIndexChecksum) {
      renderer.uploadIndices(this.index, this.indexByteSize, indexGl);
      this.lastIndexChecksum = checksum;
      return [true, true];
    } else {
      return [true, false];
    }
  }

  addPrebaked(baked: RenderBaker): void {
    const sourceG = new Uint8Array(baked.geometry, 0, baked.geometryByteSize);
    const destinationG = new Uint8Array(this.geometry);
    destinationG.set(sourceG, this.geometryByteSize);
    const sourceI = new Uint8Array(baked.index, 0, baked.indexByteSize);
    const destinationI = new Uint8Array(this.index);
    destinationI.set(sourceI, this.indexByteSize);

    for (const drawable of baked.drawables) {
      this.drawables.push({
        ...drawable,
        geometryOffset: this.geometryByteSize + drawable.geometryOffset,
        indexOffset: this.indexByteSize + drawable.indexOffset,
        instanced: drawable.instanced ? {...drawable.instanced} : undefined,
      });
    }

    this.geometryByteSize += baked.geometryByteSize;
    this.indexByteSize += baked.indexByteSize;
  }

  addAtlasedBillboard(
      center: Vec2,
      offsetPx: Vec2,
      size: Vec2,
      atlasIndex: number,
      atlasSize: Vec2,
      texture: WebGLTexture,
      z: number,
      angle: number = 0,
      tint: number = 0): void {
    this.align(256);
    this.drawables.push({
      geometryOffset: this.geometryByteSize,
      indexOffset: this.indexByteSize,
      program: this.billboardProgram,
      texture,
      z,
    });

    const bytes =
        this.billboardProgram.plan(
            center,
            offsetPx,
            size,
            tint,
            angle,
            atlasIndex,
            atlasSize,
            this.geometry,
            this.geometryByteSize);
    this.geometryByteSize += bytes;
    this.align(256);
  }

  addBillboard(
      center: Vec2,
      offsetPx: Vec2,
      size: Vec2,
      texture: WebGLTexture,
      z: number,
      angle: number = 0,
      tint: number = 0xffffffff): void {
    this.addAtlasedBillboard(center, offsetPx, size, 0, [1, 1], texture, z, angle, tint);
  }

  addHypsometry(
      center: Vec2,
      size: Vec2,
      texture: WebGLTexture,
      z: number) {
    const bytes = this.hypsometryProgram.plan(center, size, this.geometry, this.geometryByteSize);
    this.drawables.push({
      geometryOffset: this.geometryByteSize,
      indexOffset: this.indexByteSize,
      program: this.hypsometryProgram,
      texture,
      z,
    });
    this.geometryByteSize += bytes;
  }

  addLines(
      lines: Line[],
      radius: number,
      z: number,
      replace: boolean = true,
      round: boolean = true): void {
    if (lines.length === 0) {
      return;
    }

    const drawable =
        this.lineProgram.plan(lines, radius, replace, this.geometry, this.geometryByteSize);

    if (round) {
      this.drawables.push({
        ...drawable,
        instanced: {...drawable.instanced}, // !!! Modify separate from the line drawable
        geometryOffset: this.geometryByteSize,
        indexOffset: this.indexByteSize,
        program: this.lineCapProgram,
        z,
      });
    }

    this.drawables.push({
      ...drawable,
      geometryOffset: this.geometryByteSize,
      indexOffset: this.indexByteSize,
      program: this.lineProgram,
      z,
    });
    this.geometryByteSize += drawable.instanced.bytes;
  }

  addGlyphs(
      glyphs: Glyph[],
      fill: RgbaU32,
      stroke: RgbaU32,
      scale: number,
      left: Vec2,
      offset: Vec2,
      angle: number,
      atlas: WebGLTexture,
      atlasGlyphSize: number,
      z: number) {
    const drawable =
        this.sdfProgram.plan(
            glyphs,
            fill,
            stroke,
            scale,
            left,
            offset,
            angle,
            atlas,
            atlasGlyphSize,
            this.geometry,
            this.geometryByteSize);
    this.drawables.push({
      ...drawable,
      geometryOffset: this.geometryByteSize,
      indexOffset: this.indexByteSize,
      program: this.sdfProgram,
      z,
    });
    this.geometryByteSize += drawable.instanced.bytes;
  }

  addTriangles(
      indices: ArrayLike<number>,
      vertices: Float32Array|Float64Array,
      fill: RgbaU32,
      z: number) {
    const drawable =
        this.triangleProgram.plan(
            indices,
            vertices,
            fill,
            this.geometry,
            this.geometryByteSize);

    const uint32s = new Uint32Array(this.index, this.indexByteSize);
    uint32s.set(indices);

    this.drawables.push({
      ...drawable,
      geometryOffset: this.geometryByteSize,
      indexOffset: this.indexByteSize,
      program: this.triangleProgram,
      z,
    });
    this.geometryByteSize += drawable.elements.bytes;
    this.indexByteSize += indices.length * 4;
  }

  private align(alignment: number): void {
    this.geometryByteSize =
        Math.trunc((this.geometryByteSize + alignment - 1) / alignment) * alignment;
  }
}

