import { checkExists } from 'js/common/asserts';

import { RgbaU32 } from '../common/types';

import { COLOR_OPERATIONS, Drawable, Program, ProgramData } from './program';

// We write the stipple with 4 bytes to keep the 32bit numbers aligned.
export const VERTEX_STRIDE =
    4 * (
        2 + 2
            + /* fill= */ 1
            + /* stroke= */ 1
            + /* distanceAlong= */ 1
            + /* radius= */ 1
            + /* stipple= */ 1
    );

/** Renders instanced lines as rectangles without mitering. */
export class LineProgram extends Program<LineProgramData> {

  static push(
      colorFill: RgbaU32,
      colorStroke: RgbaU32,
      radius: number,
      stipple: boolean,
      points: ArrayLike<number>,
      buffer: ArrayBuffer,
      offset: number,
  ): {
    geometryByteLength: number;
    geometryOffset: number;
    instanceCount: number;
    vertexCount: number;
  } {
    const floats = new Float32Array(buffer, offset);
    // Values that may represent NaN floats (colors) cannot be written as floats due to NaN
    // canonicalization. So we have to write them as uints to the same buffer.
    const uint32s = new Uint32Array(buffer, offset);

    let vertexOffset = 0;
    const stride = VERTEX_STRIDE / 4;
    let distanceAlong = 0;
    for (let i = 0; i < points.length - 2; i += 2) {
      const x = points[i + 0];
      const y = points[i + 1];
      const xp = points[i + 2];
      const yp = points[i + 3];
      floats[vertexOffset + 0] = x;
      floats[vertexOffset + 1] = y;
      floats[vertexOffset + 2] = xp;
      floats[vertexOffset + 3] = yp;

      uint32s[vertexOffset + 4] = colorFill;
      uint32s[vertexOffset + 5] = colorStroke;
      floats[vertexOffset + 6] = distanceAlong;
      floats[vertexOffset + 7] = radius;
      uint32s[vertexOffset + 8] = stipple ? 1 : 0;

      distanceAlong += Math.sqrt((xp - x) * (xp - x) + (yp - y) * (yp - y));
      vertexOffset += stride;
    }

    return {
      geometryByteLength: vertexOffset * 4,
      geometryOffset: offset,
      instanceCount: vertexOffset / stride,
      vertexCount: 4,
    };
  }

  private readonly lineBuffer: WebGLBuffer;

  constructor(gl: WebGL2RenderingContext) {
    super(createLineProgram(gl), gl, gl.TRIANGLE_STRIP);

    this.lineBuffer = checkExists(gl.createBuffer());
    gl.bindBuffer(gl.COPY_WRITE_BUFFER, this.lineBuffer);
    const square =
        new Float32Array([
          0, -1,
          0, 1,
          1, -1,
          1, 1,
        ]);
    gl.bufferData(gl.COPY_WRITE_BUFFER, square, gl.STATIC_DRAW);
    gl.bindBuffer(gl.COPY_WRITE_BUFFER, null);
    this.registerDisposer(() => {
      gl.deleteBuffer(this.lineBuffer);
    });
  }

  plan(
      colorFill: RgbaU32,
      colorStroke: RgbaU32,
      radius: number,
      stipple: boolean,
      z: number,
      points: ArrayLike<number>,
      buffer: ArrayBuffer,
      offset: number,
      glBuffer: WebGLBuffer,
  ): Drawable {
    const result =
        LineProgram.push(colorFill, colorStroke, radius, stipple, points, buffer, offset);

    return {
      elements: undefined,
      geometry: glBuffer,
      geometryByteLength: result.geometryByteLength,
      geometryOffset: result.geometryOffset,
      instanced: {
        count: result.instanceCount,
      },
      program: this,
      texture: undefined,
      vertexCount: result.vertexCount,
      z,
    };
  }

  protected activate(): void {
    const gl = this.gl;

    gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuffer);
    gl.enableVertexAttribArray(this.program.attributes.position);
    gl.vertexAttribPointer(
        this.program.attributes.position,
        2,
        gl.FLOAT,
        /* normalize= */ false,
        /* stride= */ 0,
        /* offset= */ 0);

    gl.enableVertexAttribArray(this.program.attributes.colorFill);
    gl.vertexAttribDivisor(this.program.attributes.colorFill, 1);
    gl.enableVertexAttribArray(this.program.attributes.colorStroke);
    gl.vertexAttribDivisor(this.program.attributes.colorStroke, 1);
    gl.enableVertexAttribArray(this.program.attributes.previous);
    gl.vertexAttribDivisor(this.program.attributes.previous, 1);
    gl.enableVertexAttribArray(this.program.attributes.next);
    gl.vertexAttribDivisor(this.program.attributes.next, 1);
    gl.enableVertexAttribArray(this.program.attributes.distanceAlong);
    gl.vertexAttribDivisor(this.program.attributes.distanceAlong, 1);
    gl.enableVertexAttribArray(this.program.attributes.radius);
    gl.vertexAttribDivisor(this.program.attributes.radius, 1);
    gl.enableVertexAttribArray(this.program.attributes.stipple);
    gl.vertexAttribDivisor(this.program.attributes.stipple, 1);
  }

  protected override bindAttributes(offset: number): void {
    const gl = this.gl;

    gl.vertexAttribPointer(
        this.program.attributes.previous,
        2,
        gl.FLOAT,
        /* normalize= */ false,
        /* stride= */ VERTEX_STRIDE,
        /* offset= */ offset + 0);
    gl.vertexAttribPointer(
        this.program.attributes.next,
        2,
        gl.FLOAT,
        /* normalize= */ false,
        /* stride= */ VERTEX_STRIDE,
        /* offset= */ offset + 8);
    gl.vertexAttribPointer(
        this.program.attributes.colorFill,
        1,
        gl.FLOAT,
        /* normalize= */ false,
        /* stride= */ VERTEX_STRIDE,
        /* offset= */ offset + 16);
    gl.vertexAttribPointer(
        this.program.attributes.colorStroke,
        1,
        gl.FLOAT,
        /* normalize= */ false,
        /* stride= */ VERTEX_STRIDE,
        /* offset= */ offset + 20);
    gl.vertexAttribPointer(
        this.program.attributes.distanceAlong,
        1,
        gl.FLOAT,
        /* normalize= */ false,
        /* stride= */ VERTEX_STRIDE,
        /* offset= */ offset + 24);
    gl.vertexAttribPointer(
        this.program.attributes.radius,
        1,
        gl.FLOAT,
        /* normalize= */ false,
        /* stride= */ VERTEX_STRIDE,
        /* offset= */ offset + 28);
    gl.vertexAttribIPointer(
        this.program.attributes.stipple,
        1,
        gl.UNSIGNED_INT,
        /* stride= */ VERTEX_STRIDE,
        /* offset= */ offset + 32);
  }

  protected draw(drawable: Drawable): void {
    if (!drawable.vertexCount || !drawable.instanced) {
      throw new Error('Expecting instances');
    }

    const gl = this.gl;
    this.bindAttributes(drawable.geometryOffset);

    // Draw without the border
    gl.uniform1i(this.program.uniforms.renderBorder, 0);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, drawable.vertexCount, drawable.instanced.count);

    // Lower the z slightly so we draw under fill
    gl.uniform1f(this.program.uniforms.z, (drawable.z - 0.1) / 1000);
    gl.uniform1i(this.program.uniforms.renderBorder, 1);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, drawable.vertexCount, drawable.instanced.count);
    gl.uniform1f(this.program.uniforms.z, drawable.z / 1000);
  }

  protected deactivate(): void {
    const gl = this.gl;

    gl.disableVertexAttribArray(this.program.attributes.position);

    gl.vertexAttribDivisor(this.program.attributes.colorFill, 0);
    gl.disableVertexAttribArray(this.program.attributes.colorFill);
    gl.vertexAttribDivisor(this.program.attributes.colorStroke, 0);
    gl.disableVertexAttribArray(this.program.attributes.colorStroke);
    gl.vertexAttribDivisor(this.program.attributes.previous, 0);
    gl.disableVertexAttribArray(this.program.attributes.previous);
    gl.vertexAttribDivisor(this.program.attributes.next, 0);
    gl.disableVertexAttribArray(this.program.attributes.next);
    gl.vertexAttribDivisor(this.program.attributes.distanceAlong, 0);
    gl.disableVertexAttribArray(this.program.attributes.distanceAlong);
    gl.vertexAttribDivisor(this.program.attributes.radius, 0);
    gl.disableVertexAttribArray(this.program.attributes.radius);
    gl.vertexAttribDivisor(this.program.attributes.stipple, 0);
    gl.disableVertexAttribArray(this.program.attributes.stipple);
  }
}

interface LineProgramData extends ProgramData {
  attributes: {
    colorFill: number;
    colorStroke: number;
    distanceAlong: number;
    next: number;
    position: number;
    previous: number;
    radius: number;
    stipple: number;
  };
  uniforms: {
    cameraCenter: WebGLUniformLocation;
    halfViewportSize: WebGLUniformLocation;
    halfWorldSize: WebGLUniformLocation;
    renderBorder: WebGLUniformLocation;
    z: WebGLUniformLocation;
  };
}

function createLineProgram(gl: WebGL2RenderingContext): LineProgramData {
  const programId = checkExists(gl.createProgram());

  const vs = `#version 300 es
      // This is a Mercator coordinate ranging from -1 to 1 on both x and y
      uniform highp vec2 cameraCenter;
      uniform highp vec2 halfViewportSize;
      uniform highp float halfWorldSize;
      uniform bool renderBorder;
      uniform highp float z;

      // x is either 0 or 1, y is either -1 or 1.
      in highp vec2 position;

      // These are Mercator coordinates ranging from -1 to 1 on both x and y
      in highp vec2 previous;
      in highp vec2 next;

      in highp float colorFill;
      in highp float colorStroke;
      // A distance in Mercator coordinates
      in highp float distanceAlong;
      // This is a radius in pixels
      in highp float radius;
      // We treat this as a boolean for now
      in uint stipple;

      // See https://github.com/visgl/luma.gl/issues/1764
      invariant gl_Position;

      out lowp vec4 fragColorFill;
      out lowp vec4 fragColorStroke;
      out lowp float fragDistanceAlong;
      out lowp float fragRadius;
      out lowp float fragStipple;
      out lowp float fragDistanceOrtho;

      ${COLOR_OPERATIONS}

      vec2 perpendicular(vec2 v) {
        return vec2(-v.y, v.x);
      }

      void main() {
        vec2 center = position.x < 0.5 ? previous : next;
        vec2 direction = next - previous;
        vec2 perp = perpendicular(normalize(direction));
        vec2 location = -cameraCenter + center;
        highp float actualRadius = renderBorder ? radius : radius - 1.;
        vec2 push = perp * actualRadius * position.y;
        vec2 worldCoord = location * halfWorldSize + push;
        gl_Position = vec4(worldCoord / halfViewportSize, z, 1);

        fragColorFill = uint32FToVec4(colorFill);
        fragColorStroke = uint32FToVec4(colorStroke);
        // We want to avoid stipples "dancing" as zoom changes, so we make this more of a step
        // change.
        fragDistanceAlong =
            exp2(floor(2. * log2(halfWorldSize)) / 2.)
                * (distanceAlong + position.x * length(direction));
        fragDistanceOrtho = position.y * actualRadius;
        fragRadius = radius;
        fragStipple = stipple > 0u ? 0.5 : 1.0;
      }
    `;
  const fs = `#version 300 es
      in lowp vec4 fragColorFill;
      in lowp vec4 fragColorStroke;
      in lowp float fragDistanceAlong;
      in lowp float fragDistanceOrtho;
      in lowp float fragRadius;
      in lowp float fragStipple;

      out lowp vec4 fragColor;

      void main() {
        mediump float a =
            1. - smoothstep(0., 1., clamp(abs(fragDistanceOrtho) + 0.75 - fragRadius, 0., 1.));
        // 0 is fill, 1 is stroke
        mediump float m =
            smoothstep(0., 1., clamp(abs(fragDistanceOrtho) + 1. - fragRadius, 0., 1.));

        lowp vec4 color = mix(fragColorFill, fragColorStroke, m);
        lowp float stipple = fract(fragDistanceAlong / 8.) <= fragStipple ? 1. : 0.;
        fragColor = stipple * vec4(color.rgb * color.a, color.a) * a;
      }
  `;

  const vertexId = checkExists(gl.createShader(gl.VERTEX_SHADER));
  gl.shaderSource(vertexId, vs);
  gl.compileShader(vertexId);
  if (!gl.getShaderParameter(vertexId, gl.COMPILE_STATUS)) {
    throw new Error(`Unable to compile line vertex shader: ${gl.getShaderInfoLog(vertexId)}`);
  }
  gl.attachShader(programId, vertexId);

  const fragmentId = checkExists(gl.createShader(gl.FRAGMENT_SHADER));
  gl.shaderSource(fragmentId, fs);
  gl.compileShader(fragmentId);
  if (!gl.getShaderParameter(fragmentId, gl.COMPILE_STATUS)) {
    throw new Error(`Unable to compile line fragment shader: ${gl.getShaderInfoLog(fragmentId)}`);
  }
  gl.attachShader(programId, fragmentId);

  gl.linkProgram(programId);
  if (!gl.getProgramParameter(programId, gl.LINK_STATUS)) {
    throw new Error(`Unable to link line program: ${gl.getProgramInfoLog(programId)}`);
  }

  return {
    handle: programId,
    attributes: {
      colorFill: checkExists(gl.getAttribLocation(programId, 'colorFill')),
      colorStroke: checkExists(gl.getAttribLocation(programId, 'colorStroke')),
      next: checkExists(gl.getAttribLocation(programId, 'next')),
      position: checkExists(gl.getAttribLocation(programId, 'position')),
      previous: checkExists(gl.getAttribLocation(programId, 'previous')),
      distanceAlong: checkExists(gl.getAttribLocation(programId, 'distanceAlong')),
      radius: checkExists(gl.getAttribLocation(programId, 'radius')),
      stipple: checkExists(gl.getAttribLocation(programId, 'stipple')),
    },
    uniforms: {
      cameraCenter: checkExists(gl.getUniformLocation(programId, 'cameraCenter')),
      halfViewportSize: checkExists(gl.getUniformLocation(programId, 'halfViewportSize')),
      halfWorldSize: checkExists(gl.getUniformLocation(programId, 'halfWorldSize')),
      renderBorder: checkExists(gl.getUniformLocation(programId, 'renderBorder')),
      z: checkExists(gl.getUniformLocation(programId, 'z')),
    },
  };
}

