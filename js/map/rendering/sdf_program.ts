import { checkExists } from 'external/dev_april_corgi~/js/common/asserts';

import { RgbaU32, Vec2 } from '../common/types';

import { COLOR_OPERATIONS, Drawable, FP64_OPERATIONS, Program, ProgramData } from './program';

export interface Glyph {
  index: number;
  glyphAdvance: number;
  glyphWidth: number;
  glyphHeight: number;
  glyphTop: number;
  width: number;
  height: number;
}

export class SdfProgram extends Program<SdfProgramData> {

  readonly atlas: WebGLTexture;
  private readonly sdfBuffer: WebGLBuffer;

  constructor(gl: WebGL2RenderingContext) {
    super(createSdfProgram(gl), gl, gl.TRIANGLE_STRIP);
    this.registerDisposer(() => {
      gl.deleteBuffer(this.sdfBuffer);
      gl.deleteProgram(this.program.handle);
      gl.deleteTexture(this.atlas);
    });

    this.atlas = checkExists(gl.createTexture());

    this.sdfBuffer = checkExists(gl.createBuffer());
    gl.bindBuffer(gl.COPY_WRITE_BUFFER, this.sdfBuffer);
    const square =
        new Float32Array([
          -0.5, -0.5, 0, 1,
          -0.5, 0.5, 0, 0,
          0.5, -0.5, 1, 1,
          0.5, 0.5, 1, 0,
        ]);
    gl.bufferData(gl.COPY_WRITE_BUFFER, square, gl.STATIC_DRAW);
    gl.bindBuffer(gl.COPY_WRITE_BUFFER, null);
  }

  plan(
      glyphs: Glyph[],
      center: Vec2,
      offsetPx: Vec2,
      scale: number,
      angle: number,
      fill: RgbaU32,
      stroke: RgbaU32,
      z: number,
      atlasSize: Vec2,
      buffer: ArrayBuffer,
      offset: number,
      glBuffer: WebGLBuffer,
  ): {byteSize: number; drawable: Drawable;} {
    const floats = new Float32Array(buffer, offset);
    const uint32s = new Uint32Array(buffer, offset);
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);

    let width = 0;
    for (const glyph of glyphs) {
      width += glyph.glyphAdvance * scale;
    }
    let xOffset = offsetPx[0] - width / 2 * cos;
    let yOffset = offsetPx[1] - width / 2 * sin;

    let count = 0;
    for (const glyph of glyphs) {
      const charXOffset = xOffset - glyph.glyphTop * scale * sin;
      const charYOffset = yOffset + glyph.glyphTop * scale * cos;

      floats.set([
        /* center= */ center[0], center[1],
        /* offsetPx= */ charXOffset, charYOffset,
        /* size= */ glyph.width * scale, glyph.height * scale,
        /* angle= */ angle,
      ], count);
      count += 7;

      uint32s.set([
        /* atlasIndex= */ glyph.index,
        /* atlasSize= */ atlasSize[0], atlasSize[1],
        /* fill= */ fill,
        /* fill= */ stroke,
      ], count);
      count += 5;

      const xAdvance = glyph.glyphAdvance * scale;
      xOffset += cos * xAdvance;
      yOffset += sin * xAdvance;
    }

    return {
      byteSize: count * 4,
      drawable: {
        elements: undefined,
        geometry: glBuffer,
        geometryByteLength: 4 * count,
        geometryOffset: offset,
        instanced: {
          count: glyphs.length,
        },
        program: this,
        texture: this.atlas,
        vertexCount: 4,
        z,
      },
    };
  }

  protected activate(): void {
    const gl = this.gl;

    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(this.program.uniforms.color, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.sdfBuffer);
    gl.enableVertexAttribArray(this.program.attributes.position);
    gl.vertexAttribPointer(
        this.program.attributes.position,
        2,
        gl.FLOAT,
        /* normalize= */ false,
        /* stride= */ 16,
        /* offset= */ 0);
    gl.enableVertexAttribArray(this.program.attributes.colorPosition);
    gl.vertexAttribPointer(
        this.program.attributes.colorPosition,
        2,
        gl.FLOAT,
        /* normalize= */ false,
        /* stride= */ 16,
        /* offset= */ 8)

    gl.enableVertexAttribArray(this.program.attributes.center);
    gl.vertexAttribDivisor(this.program.attributes.center, 1);
    gl.enableVertexAttribArray(this.program.attributes.offsetPx);
    gl.vertexAttribDivisor(this.program.attributes.offsetPx, 1);
    gl.enableVertexAttribArray(this.program.attributes.size);
    gl.vertexAttribDivisor(this.program.attributes.size, 1);
    gl.enableVertexAttribArray(this.program.attributes.angle);
    gl.vertexAttribDivisor(this.program.attributes.angle, 1);
    gl.enableVertexAttribArray(this.program.attributes.atlasIndex);
    gl.vertexAttribDivisor(this.program.attributes.atlasIndex, 1);
    gl.enableVertexAttribArray(this.program.attributes.atlasSize);
    gl.vertexAttribDivisor(this.program.attributes.atlasSize, 1);
    gl.enableVertexAttribArray(this.program.attributes.fill);
    gl.vertexAttribDivisor(this.program.attributes.fill, 1);
    gl.enableVertexAttribArray(this.program.attributes.stroke);
    gl.vertexAttribDivisor(this.program.attributes.stroke, 1);
  }

  protected override bindAttributes(offset: number): void {
    const gl = this.gl;

    gl.vertexAttribPointer(
        this.program.attributes.center,
        2,
        gl.FLOAT,
        /* normalize= */ false,
        /* stride= */ 48,
        /* offset= */ offset + 0);
    gl.vertexAttribPointer(
        this.program.attributes.offsetPx,
        2,
        gl.FLOAT,
        /* normalize= */ false,
        /* stride= */ 48,
        /* offset= */ offset + 8);
    gl.vertexAttribPointer(
        this.program.attributes.size,
        2,
        gl.FLOAT,
        /* normalize= */ false,
        /* stride= */ 48,
        /* offset= */ offset + 16);
    gl.vertexAttribPointer(
        this.program.attributes.angle,
        1,
        gl.FLOAT,
        /* normalize= */ false,
        /* stride= */ 48,
        /* offset= */ offset + 24);
    gl.vertexAttribIPointer(
        this.program.attributes.atlasIndex,
        1,
        gl.UNSIGNED_INT,
        /* stride= */ 48,
        /* offset= */ offset + 28);
    gl.vertexAttribIPointer(
        this.program.attributes.atlasSize,
        2,
        gl.UNSIGNED_INT,
        /* stride= */ 48,
        /* offset= */ offset + 32);
    gl.vertexAttribIPointer(
        this.program.attributes.fill,
        1,
        gl.UNSIGNED_INT,
        /* stride= */ 48,
        /* offset= */ offset + 40);
    gl.vertexAttribIPointer(
        this.program.attributes.stroke,
        1,
        gl.UNSIGNED_INT,
        /* stride= */ 48,
        /* offset= */ offset + 44);
  }

  protected draw(drawable: Drawable): void {
    if (!drawable.vertexCount || !drawable.instanced) {
      throw new Error('Expecting instances');
    }

    const gl = this.gl;
    this.bindAttributes(drawable.geometryOffset);

    gl.uniform1f(this.program.uniforms.halo, 0.35);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, drawable.vertexCount, drawable.instanced.count);
    gl.uniform1f(this.program.uniforms.halo, 0.75);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, drawable.vertexCount, drawable.instanced.count);
  }

  protected deactivate(): void {
    const gl = this.gl;

    gl.disableVertexAttribArray(this.program.attributes.position);
    gl.disableVertexAttribArray(this.program.attributes.colorPosition);

    gl.disableVertexAttribArray(this.program.attributes.center);
    gl.vertexAttribDivisor(this.program.attributes.center, 0);
    gl.disableVertexAttribArray(this.program.attributes.offsetPx);
    gl.vertexAttribDivisor(this.program.attributes.offsetPx, 0);
    gl.disableVertexAttribArray(this.program.attributes.size);
    gl.vertexAttribDivisor(this.program.attributes.size, 0);
    gl.disableVertexAttribArray(this.program.attributes.angle);
    gl.vertexAttribDivisor(this.program.attributes.angle, 0);
    gl.disableVertexAttribArray(this.program.attributes.atlasIndex);
    gl.vertexAttribDivisor(this.program.attributes.atlasIndex, 0);
    gl.disableVertexAttribArray(this.program.attributes.atlasSize);
    gl.vertexAttribDivisor(this.program.attributes.atlasSize, 0);
    gl.disableVertexAttribArray(this.program.attributes.fill);
    gl.vertexAttribDivisor(this.program.attributes.fill, 0);
    gl.disableVertexAttribArray(this.program.attributes.stroke);
    gl.vertexAttribDivisor(this.program.attributes.stroke, 0);
  }
}

interface SdfProgramData extends ProgramData {
  attributes: {
    position: number;
    colorPosition: number;
    center: number;
    offsetPx: number;
    size: number;
    angle: number;
    atlasIndex: number;
    atlasSize: number;
    fill: number;
    stroke: number;
  };

  uniforms: {
    cameraCenter: WebGLUniformLocation;
    color: WebGLUniformLocation;
    halfViewportSize: WebGLUniformLocation;
    halfWorldSize: WebGLUniformLocation;
    halo: WebGLUniformLocation;
    z: WebGLUniformLocation;
  };
}

function createSdfProgram(gl: WebGL2RenderingContext): SdfProgramData {
  const programId = checkExists(gl.createProgram());

  const vs = `#version 300 es
      // Mercator coordinates range from -1 to 1 on both x and y
      // Pixels are in screen space (eg -320px to 320px for a 640px width)

      uniform highp vec4 cameraCenter; // Mercator
      uniform highp vec2 halfViewportSize; // pixels
      uniform highp float halfWorldSize; // pixels
      uniform mediump float halo;
      uniform highp float z;

      in highp vec2 position;
      in mediump vec2 colorPosition;
      in highp vec2 center; // Mercator
      in highp vec2 offsetPx; // pixels
      in highp vec2 size; // pixels
      in highp float angle; // Radians
      in uint atlasIndex;
      in uvec2 atlasSize;
      in uint fill;
      in uint stroke;

      // See https://github.com/visgl/luma.gl/issues/1764
      invariant gl_Position;

      out mediump vec2 fragColorPosition;
      out mediump vec4 fragColorFill;

      ${COLOR_OPERATIONS}
      ${FP64_OPERATIONS}

      void main() {
        vec4 relativeCenter = sub_fp64(split(center), cameraCenter);
        vec4 extents = mul_fp64(split(position), split(size));
        vec2 c = split(cos(angle));
        vec2 s = split(sin(angle));
        vec4 rotated =
            vec4(
                sub_fp64(mul_fp64(extents.xy, c), mul_fp64(extents.zw, s)),
                sum_fp64(mul_fp64(extents.xy, s), mul_fp64(extents.zw, c)));
        vec4 worldCoord =
            sum_fp64(
                mul_fp64(relativeCenter, vec4(split(halfWorldSize), split(halfWorldSize))),
                rotated);
        vec4 screenCoord = sum_fp64(worldCoord, split(offsetPx));
        vec4 p = div_fp64(screenCoord, split(halfViewportSize));
        gl_Position = vec4(p.x + p.y, p.z + p.w, z, 1);

        uvec2 atlasXy = uvec2(
            atlasIndex % atlasSize.x, atlasIndex / atlasSize.x);
        vec2 scale = 1. / vec2(atlasSize);
        vec2 translate = vec2(atlasXy) * scale;
        fragColorPosition = translate + scale * colorPosition;
        fragColorFill = uint32ToVec4(halo < 0.6 ? stroke : fill);
      }
    `;
  const fs = `#version 300 es
      uniform sampler2D color;
      uniform mediump float halo;

      in mediump vec2 fragColorPosition;
      in mediump vec4 fragColorFill;
      out mediump vec4 fragColor;

      void main() {
        highp float gamma = 0.022096875;
        mediump float distance = texture(color, fragColorPosition).a;
        mediump float alpha = smoothstep(halo - gamma, halo + gamma, distance);
        fragColor = fragColorFill * alpha;
      }
  `;

  const vertexId = checkExists(gl.createShader(gl.VERTEX_SHADER));
  gl.shaderSource(vertexId, vs);
  gl.compileShader(vertexId);
  if (!gl.getShaderParameter(vertexId, gl.COMPILE_STATUS)) {
    throw new Error(`Unable to compile sdf vertex shader: ${gl.getShaderInfoLog(vertexId)}`);
  }
  gl.attachShader(programId, vertexId);

  const fragmentId = checkExists(gl.createShader(gl.FRAGMENT_SHADER));
  gl.shaderSource(fragmentId, fs);
  gl.compileShader(fragmentId);
  if (!gl.getShaderParameter(fragmentId, gl.COMPILE_STATUS)) {
    throw new Error(`Unable to compile sdf fragment shader: ${gl.getShaderInfoLog(fragmentId)}`);
  }
  gl.attachShader(programId, fragmentId);

  gl.linkProgram(programId);
  if (!gl.getProgramParameter(programId, gl.LINK_STATUS)) {
    throw new Error(`Unable to link sdf program: ${gl.getProgramInfoLog(programId)}`);
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
      fill: gl.getAttribLocation(programId, 'fill'),
      stroke: gl.getAttribLocation(programId, 'stroke'),
    },
    uniforms: {
      cameraCenter: checkExists(gl.getUniformLocation(programId, 'cameraCenter')),
      color: checkExists(gl.getUniformLocation(programId, 'color')),
      halfViewportSize: checkExists(gl.getUniformLocation(programId, 'halfViewportSize')),
      halfWorldSize: checkExists(gl.getUniformLocation(programId, 'halfWorldSize')),
      halo: checkExists(gl.getUniformLocation(programId, 'halo')),
      z: checkExists(gl.getUniformLocation(programId, 'z')),
    },
  };
}
