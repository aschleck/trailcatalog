import { checkExists } from 'js/common/asserts';

import { RgbaU32, Vec2 } from '../common/types';

import { COLOR_OPERATIONS, Drawable, FP64_OPERATIONS, Program, ProgramData } from './program';

export interface Glyph {
  index: number;
  glyphAdvance: number;
  glyphWidth: number;
  glyphHeight: number;
  glyphTop: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface SdfDrawable {
  instanced: {
    bytes: number;
    count: number;
  };
  texture: WebGLTexture;
  fill: RgbaU32;
  stroke: RgbaU32;
}

export const VERTEX_STRIDE =
    4 * (
        /* atlasPositionAndSize= */ 4
            + /* center= */ 4
            + /* offset= */ 2
            + /* size= */ 2
            + /* angle= */ 1
    );

export class SdfProgram extends Program<SdfProgramData> {

  private readonly sdfBuffer: WebGLBuffer;

  constructor(gl: WebGL2RenderingContext) {
    super(createSdfProgram(gl), gl);
    this.sdfBuffer =
        this.createStaticBuffer(
                new Float32Array([
                  0, -0.5, 0, 1,
                  0, 0.5, 0, 0,
                  1, -0.5, 1, 1,
                  1, 0.5, 1, 0,
                ]));
  }

  plan(
      glyphs: Glyph[],
      fill: RgbaU32,
      stroke: RgbaU32,
      scale: number,
      left: Vec2,
      offset: Vec2,
      angle: number,
      atlas: WebGLTexture,
      atlasGlyphSize: number,
      buffer: ArrayBuffer,
      bufferOffset: number): SdfDrawable {
    const floats = new Float32Array(buffer, bufferOffset);
    // Values that may represent NaN floats (colors) cannot be written as floats due to NaN
    // canonicalization. So we have to write them as uints to the same buffer.
    const uint32s = new Uint32Array(buffer, bufferOffset);

    let vertexOffset = 0;
    for (const glyph of glyphs) {
      floats[vertexOffset + 0] = glyph.x;
      floats[vertexOffset + 1] = glyph.y;
      floats[vertexOffset + 2] = glyph.width;
      floats[vertexOffset + 3] = glyph.height;

      const xF = Math.fround(left[0]);
      const xR = left[0] - xF;
      floats[vertexOffset + 4] = xF;
      floats[vertexOffset + 5] = xR;
      const yF = Math.fround(left[1]);
      const yR = left[1] - yF;
      floats[vertexOffset + 6] = yF;
      floats[vertexOffset + 7] = yR;

      floats[vertexOffset + 8] = offset[0];
      floats[vertexOffset + 9] = offset[1] + glyph.glyphTop * scale;
      floats[vertexOffset + 10] = atlasGlyphSize * scale;
      floats[vertexOffset + 11] = atlasGlyphSize * scale;
      floats[vertexOffset + 12] = angle;

      offset[0] += glyph.glyphAdvance * scale;
      vertexOffset += VERTEX_STRIDE / 4;
    }

    return {
      instanced: {
        bytes: vertexOffset * 4,
        count: glyphs.length,
      },
      texture: atlas,
      fill,
      stroke,
    };
  }

  protected activate(): void {
    const gl = this.gl;

    gl.useProgram(this.program.id);
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
        /* offset= */ 8);

    gl.enableVertexAttribArray(this.program.attributes.atlasPositionAndSize);
    gl.vertexAttribDivisor(this.program.attributes.atlasPositionAndSize, 1);
    gl.enableVertexAttribArray(this.program.attributes.center);
    gl.vertexAttribDivisor(this.program.attributes.center, 1);
    gl.enableVertexAttribArray(this.program.attributes.offset);
    gl.vertexAttribDivisor(this.program.attributes.offset, 1);
    gl.enableVertexAttribArray(this.program.attributes.size);
    gl.vertexAttribDivisor(this.program.attributes.size, 1);
    gl.enableVertexAttribArray(this.program.attributes.angle);
    gl.vertexAttribDivisor(this.program.attributes.angle, 1);

    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(this.program.uniforms.alphaSampler, 0);
  }

  protected bind(offset: number): void {
    const gl = this.gl;

    gl.vertexAttribPointer(
        this.program.attributes.atlasPositionAndSize,
        4,
        gl.FLOAT,
        /* normalize= */ false,
        /* stride= */ VERTEX_STRIDE,
        /* offset= */ offset + 0);
    gl.vertexAttribPointer(
        this.program.attributes.center,
        4,
        gl.FLOAT,
        /* normalize= */ false,
        /* stride= */ VERTEX_STRIDE,
        /* offset= */ offset + 16);
    gl.vertexAttribPointer(
        this.program.attributes.offset,
        2,
        gl.FLOAT,
        /* normalize= */ false,
        /* stride= */ VERTEX_STRIDE,
        /* offset= */ offset + 32);
    gl.vertexAttribPointer(
        this.program.attributes.size,
        2,
        gl.FLOAT,
        /* normalize= */ false,
        /* stride= */ VERTEX_STRIDE,
        /* offset= */ offset + 40);
    gl.vertexAttribPointer(
        this.program.attributes.angle,
        1,
        gl.FLOAT,
        /* normalize= */ false,
        /* stride= */ VERTEX_STRIDE,
        /* offset= */ offset + 48);
  }

  protected draw(drawable: Drawable): void {
    if (!drawable.instanced) {
      throw new Error('Expecting instances');
    }

    const gl = this.gl;

    gl.uniform1f(this.program.uniforms.halo, 0.52);
    gl.uniform1ui(this.program.uniforms.textColor, drawable.fill ?? 0);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, this.program.vertexCount, drawable.instanced.count);

    gl.uniform1f(this.program.uniforms.halo, 0.75);
    gl.uniform1ui(this.program.uniforms.textColor, drawable.stroke ?? 0);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, this.program.vertexCount, drawable.instanced.count);
  }

  protected deactivate(): void {
    const gl = this.gl;

    gl.disableVertexAttribArray(this.program.attributes.position);
    gl.disableVertexAttribArray(this.program.attributes.colorPosition);

    gl.disableVertexAttribArray(this.program.attributes.atlasPositionAndSize);
    gl.vertexAttribDivisor(this.program.attributes.atlasPositionAndSize, 0);
    gl.disableVertexAttribArray(this.program.attributes.center);
    gl.vertexAttribDivisor(this.program.attributes.center, 0);
    gl.disableVertexAttribArray(this.program.attributes.offset);
    gl.vertexAttribDivisor(this.program.attributes.offset, 0);
    gl.disableVertexAttribArray(this.program.attributes.size);
    gl.vertexAttribDivisor(this.program.attributes.size, 0);
    gl.disableVertexAttribArray(this.program.attributes.angle);
    gl.vertexAttribDivisor(this.program.attributes.angle, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.useProgram(null);
  }
}

interface SdfProgramData extends ProgramData {
  id: WebGLProgram;

  attributes: {
    position: number;
    colorPosition: number;
    atlasPositionAndSize: number;
    center: number;
    offset: number;
    size: number;
    angle: number;
  };

  uniforms: {
    cameraCenter: WebGLUniformLocation;
    alphaSampler: WebGLUniformLocation;
    halfViewportSize: WebGLUniformLocation;
    halfWorldSize: WebGLUniformLocation;
    halo: WebGLUniformLocation;
    textColor: WebGLUniformLocation;
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
      uniform uint textColor;

      in highp vec2 position;
      in mediump vec2 colorPosition;

      in mediump vec4 atlasPositionAndSize;
      in highp vec4 center; // Mercator
      in mediump vec2 offset; // Pixels
      in mediump vec2 size; // Pixels
      in mediump float angle; // Radians

      out mediump vec2 fragColorPosition;
      out mediump vec4 fragTextColor;

      ${COLOR_OPERATIONS}
      ${FP64_OPERATIONS}

      void main() {
        // This is a load bearing ternary operator: it seems to defeat some bad optimizations that
        // reduce our float precision.
        vec4 alwaysCameraCenter = position.x < 1000.0 ? cameraCenter : center;
        vec4 relativeCenter = center - alwaysCameraCenter;
        mat2 rotation = mat2(cos(angle), sin(angle), -sin(angle), cos(angle));
        vec2 extents = rotation * (position * size + offset);
        vec2 screenCoord = reduce64(relativeCenter * halfWorldSize) + extents;
        gl_Position = vec4(screenCoord / halfViewportSize, 0, 1);

        fragTextColor = uint32ToVec4(textColor);
        fragColorPosition = atlasPositionAndSize.xy + colorPosition * atlasPositionAndSize.zw;
      }
    `;
  const fs = `#version 300 es
      uniform sampler2D alphaSampler;
      uniform mediump float halo;

      in mediump vec4 fragTextColor;
      in mediump vec2 fragColorPosition;
      out mediump vec4 fragColor;

      void main() {
        highp float gamma = 0.022096875;
        mediump float distance = texture(alphaSampler, fragColorPosition).a;
        highp float alpha = smoothstep(halo - gamma, halo + gamma, distance);
        fragColor = fragTextColor * alpha;
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
    id: programId,
    attributes: {
      position: gl.getAttribLocation(programId, 'position'),
      colorPosition: gl.getAttribLocation(programId, 'colorPosition'),
      atlasPositionAndSize: gl.getAttribLocation(programId, 'atlasPositionAndSize'),
      center: gl.getAttribLocation(programId, 'center'),
      offset: gl.getAttribLocation(programId, 'offset'),
      size: gl.getAttribLocation(programId, 'size'),
      angle: gl.getAttribLocation(programId, 'angle'),
    },
    uniforms: {
      alphaSampler: checkExists(gl.getUniformLocation(programId, 'alphaSampler')),
      cameraCenter: checkExists(gl.getUniformLocation(programId, 'cameraCenter')),
      halfViewportSize: checkExists(gl.getUniformLocation(programId, 'halfViewportSize')),
      halfWorldSize: checkExists(gl.getUniformLocation(programId, 'halfWorldSize')),
      halo: checkExists(gl.getUniformLocation(programId, 'halo')),
      textColor: checkExists(gl.getUniformLocation(programId, 'textColor')),
    },
    vertexCount: 4,
  };
}
