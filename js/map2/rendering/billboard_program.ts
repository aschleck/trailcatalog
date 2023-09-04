import { checkExists } from 'js/common/asserts';

import { RgbaU32, Vec2 } from '../common/types';

import { COLOR_OPERATIONS, Drawable, Program, ProgramData } from './program';

export class BillboardProgram extends Program<BillboardProgramData> {

  private readonly billboardData: Float32Array;

  constructor(gl: WebGL2RenderingContext) {
    super(createBillboardProgram(gl), gl, gl.TRIANGLE_STRIP);
    this.registerDisposer(() => {
      gl.deleteProgram(this.program.handle);
    });

    this.billboardData = new Float32Array([
      -0.5, -0.5, 0, 1,
      -0.5, 0.5, 0, 0,
      0.5, -0.5, 1, 1,
      0.5, 0.5, 1, 0,
    ]);
  }

  plan(
      center: Vec2,
      offsetPx: Vec2,
      size: Vec2,
      angle: number,
      tint: RgbaU32,
      z: number,
      atlasIndex: number,
      atlasSize: Vec2,
      buffer: ArrayBuffer,
      offset: number,
      glBuffer: WebGLBuffer,
      glTexture: WebGLTexture,
  ): {byteSize: number; drawable: Drawable;} {
    const floats = new Float32Array(buffer, offset);
    const uint32s = new Uint32Array(buffer, offset);

    const x = center[0];
    const y = center[1];
    const w = size[0];
    const h = size[1];

    let count = 0;
    for (let i = 0; i < this.billboardData.length; i += 4) {
      floats.set([
        /* position= */ this.billboardData[i + 0], this.billboardData[i + 1],
        /* colorPosition= */ this.billboardData[i + 2], this.billboardData[i + 3],
        /* center= */ x, y,
        /* offsetPx= */ offsetPx[0], offsetPx[1],
        /* size= */ w, h,
        /* angle= */ angle,
      ], count);
      count += 11;

      uint32s.set([
        /* atlasIndex= */ atlasIndex,
        /* atlasSize= */ atlasSize[0], atlasSize[1],
        /* tint= */ tint,
        /* sizeIsPixels= */ size[0] >= 1 ? 1 : 0, // well this is sketchy
      ], count);
      count += 5;
    }

    return {
      byteSize: count * 4,
      drawable: {
        elements: undefined,
        geometry: glBuffer,
        geometryByteLength: 4 * count,
        geometryOffset: offset,
        program: this,
        texture: glTexture,
        vertexCount: this.billboardData.length / 4,
        z,
      },
    };
  }

  protected activate(): void {
    const gl = this.gl;

    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(this.program.uniforms.color, 0);

    gl.enableVertexAttribArray(this.program.attributes.position);
    gl.enableVertexAttribArray(this.program.attributes.colorPosition);
    gl.enableVertexAttribArray(this.program.attributes.center);
    gl.enableVertexAttribArray(this.program.attributes.offsetPx);
    gl.enableVertexAttribArray(this.program.attributes.size);
    gl.enableVertexAttribArray(this.program.attributes.angle);
    gl.enableVertexAttribArray(this.program.attributes.atlasIndex);
    gl.enableVertexAttribArray(this.program.attributes.atlasSize);
    gl.enableVertexAttribArray(this.program.attributes.tint);
    gl.enableVertexAttribArray(this.program.attributes.sizeIsPixels);
  }

  protected bindAttributes(offset: number): void {
    const gl = this.gl;

    gl.vertexAttribPointer(
        this.program.attributes.position,
        2,
        gl.FLOAT,
        /* normalize= */ false,
        /* stride= */ 64,
        /* offset= */ offset + 0);
    gl.vertexAttribPointer(
        this.program.attributes.colorPosition,
        2,
        gl.FLOAT,
        /* normalize= */ false,
        /* stride= */ 64,
        /* offset= */ offset + 8);
    gl.vertexAttribPointer(
        this.program.attributes.center,
        2,
        gl.FLOAT,
        /* normalize= */ false,
        /* stride= */ 64,
        /* offset= */ offset + 16);
    gl.vertexAttribPointer(
        this.program.attributes.offsetPx,
        2,
        gl.FLOAT,
        /* normalize= */ false,
        /* stride= */ 64,
        /* offset= */ offset + 24);
    gl.vertexAttribPointer(
        this.program.attributes.size,
        2,
        gl.FLOAT,
        /* normalize= */ false,
        /* stride= */ 64,
        /* offset= */ offset + 32);
    gl.vertexAttribPointer(
        this.program.attributes.angle,
        1,
        gl.FLOAT,
        /* normalize= */ false,
        /* stride= */ 64,
        /* offset= */ offset + 40);
    gl.vertexAttribIPointer(
        this.program.attributes.atlasIndex,
        1,
        gl.UNSIGNED_INT,
        /* stride= */ 64,
        /* offset= */ offset + 44);
    gl.vertexAttribIPointer(
        this.program.attributes.atlasSize,
        2,
        gl.UNSIGNED_INT,
        /* stride= */ 64,
        /* offset= */ offset + 48);
    gl.vertexAttribIPointer(
        this.program.attributes.tint,
        1,
        gl.UNSIGNED_INT,
        /* stride= */ 64,
        /* offset= */ offset + 56);
    gl.vertexAttribIPointer(
        this.program.attributes.sizeIsPixels,
        1,
        gl.UNSIGNED_INT,
        /* stride= */ 64,
        /* offset= */ offset + 60);
  }

  protected deactivate(): void {
    const gl = this.gl;

    gl.disableVertexAttribArray(this.program.attributes.position);
    gl.disableVertexAttribArray(this.program.attributes.colorPosition);
    gl.disableVertexAttribArray(this.program.attributes.center);
    gl.disableVertexAttribArray(this.program.attributes.offsetPx);
    gl.disableVertexAttribArray(this.program.attributes.size);
    gl.disableVertexAttribArray(this.program.attributes.angle);
    gl.disableVertexAttribArray(this.program.attributes.atlasIndex);
    gl.disableVertexAttribArray(this.program.attributes.atlasSize);
    gl.disableVertexAttribArray(this.program.attributes.tint);
    gl.disableVertexAttribArray(this.program.attributes.sizeIsPixels);
  }
}

interface BillboardProgramData extends ProgramData {
  attributes: {
    position: number;
    colorPosition: number;
    center: number;
    offsetPx: number;
    size: number;
    angle: number;
    atlasIndex: number;
    atlasSize: number;
    tint: number;
    sizeIsPixels: number;
  };

  uniforms: {
    cameraCenter: WebGLUniformLocation;
    color: WebGLUniformLocation;
    halfViewportSize: WebGLUniformLocation;
    halfWorldSize: WebGLUniformLocation;
  };
}

function createBillboardProgram(gl: WebGL2RenderingContext): BillboardProgramData {
  const programId = checkExists(gl.createProgram());

  const vs = `#version 300 es
      // Mercator coordinates range from -1 to 1 on both x and y
      // Pixels are in screen space (eg -320px to 320px for a 640px width)

      uniform highp vec2 cameraCenter; // Mercator
      uniform highp vec2 halfViewportSize; // pixels
      uniform highp float halfWorldSize; // pixels

      in highp vec2 position;
      in mediump vec2 colorPosition;
      in highp vec2 center; // Mercator
      in highp vec2 offsetPx; // pixels
      in highp vec2 size; // Mercator or pixels
      in highp float angle; // Radians
      in uint atlasIndex;
      in uvec2 atlasSize;
      in uint tint;
      in uint sizeIsPixels;

      out mediump vec2 fragColorPosition;
      out mediump vec4 fragColorTint;

      ${COLOR_OPERATIONS}

      void main() {
        vec2 relativeCenter = center - cameraCenter;
        vec2 extents = position * size;
        float c = cos(angle);
        float s = sin(angle);
        vec2 rotated = vec2(extents.x * c - extents.y * s, extents.x * s + extents.y * c);
        vec2 worldCoord =
            sizeIsPixels > 0u
                ? relativeCenter * halfWorldSize + rotated
                : (relativeCenter + rotated) * halfWorldSize;
        vec2 screenCoord = worldCoord + offsetPx;
        gl_Position = vec4(screenCoord / halfViewportSize, 0, 1);

        uvec2 atlasXy = uvec2(
            atlasIndex % atlasSize.x, atlasIndex / atlasSize.y);
        vec2 scale = 1. / vec2(atlasSize);
        vec2 translate = vec2(atlasXy) * scale;
        fragColorPosition = translate + scale * colorPosition;
        fragColorTint = uint32ToVec4(tint);
      }
    `;
  const fs = `#version 300 es
      uniform sampler2D color;

      in mediump vec2 fragColorPosition;
      in mediump vec4 fragColorTint;
      out mediump vec4 fragColor;

      void main() {
        fragColor =
            texture(color, fragColorPosition) * vec4(fragColorTint.rgb, 1) * fragColorTint.a;
      }
  `;

  const vertexId = checkExists(gl.createShader(gl.VERTEX_SHADER));
  gl.shaderSource(vertexId, vs);
  gl.compileShader(vertexId);
  if (!gl.getShaderParameter(vertexId, gl.COMPILE_STATUS)) {
    throw new Error(`Unable to compile billboard vertex shader: ${gl.getShaderInfoLog(vertexId)}`);
  }
  gl.attachShader(programId, vertexId);

  const fragmentId = checkExists(gl.createShader(gl.FRAGMENT_SHADER));
  gl.shaderSource(fragmentId, fs);
  gl.compileShader(fragmentId);
  if (!gl.getShaderParameter(fragmentId, gl.COMPILE_STATUS)) {
    throw new Error(`Unable to compile billboard fragment shader: ${gl.getShaderInfoLog(fragmentId)}`);
  }
  gl.attachShader(programId, fragmentId);

  gl.linkProgram(programId);
  if (!gl.getProgramParameter(programId, gl.LINK_STATUS)) {
    throw new Error(`Unable to link billboard program: ${gl.getProgramInfoLog(programId)}`);
  }

  return {
    handle: programId,
    attributes: {
      position: gl.getAttribLocation(programId, 'position'),
      colorPosition: gl.getAttribLocation(programId, 'colorPosition'),
      center: gl.getAttribLocation(programId, 'center'),
      offsetPx: gl.getAttribLocation(programId, 'offsetPx'),
      size: gl.getAttribLocation(programId, 'size'),
      angle: gl.getAttribLocation(programId, 'angle'),
      atlasIndex: gl.getAttribLocation(programId, 'atlasIndex'),
      atlasSize: gl.getAttribLocation(programId, 'atlasSize'),
      tint: gl.getAttribLocation(programId, 'tint'),
      sizeIsPixels: gl.getAttribLocation(programId, 'sizeIsPixels'),
    },
    uniforms: {
      cameraCenter: checkExists(gl.getUniformLocation(programId, 'cameraCenter')),
      color: checkExists(gl.getUniformLocation(programId, 'color')),
      halfViewportSize: checkExists(gl.getUniformLocation(programId, 'halfViewportSize')),
      halfWorldSize: checkExists(gl.getUniformLocation(programId, 'halfWorldSize')),
    },
  };
}
