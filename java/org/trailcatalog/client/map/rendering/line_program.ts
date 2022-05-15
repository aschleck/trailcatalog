import { checkExists } from '../../common/asserts';
import { splitVec2 } from '../../common/math';

import { Line } from './geometry';
import { COLOR_OPERATIONS, Drawable, FP64_OPERATIONS, Program, ProgramData } from './program';

export const VERTEX_STRIDE = (4 + 4 + 3) * 4;

interface LineDrawable {
  bytes: number;
  instances: number;
}

/** Renders instanced lines as rectangles without mitering. */
export class LineProgram extends Program<LineProgramData> {

  private readonly lineBuffer: WebGLBuffer;

  constructor(gl: WebGL2RenderingContext) {
    super(createLineProgram(gl), gl);
    this.lineBuffer =
        this.createStaticBuffer(
                new Float32Array([
                  0, -1,
                  0, 1,
                  1, -1,
                  1, 1,
                ]));
  }

  plan(lines: Line[], radius: number, vertices: Float32Array): LineDrawable {
    let vertexOffset = 0;
    const stride = VERTEX_STRIDE / 4;
    for (const line of lines) {
      const doubles = line.vertices;
      for (let i = 0; i < doubles.length - 2; i += 2) {
        const x = doubles[i + 0];
        const y = doubles[i + 1];
        const xp = doubles[i + 2];
        const yp = doubles[i + 3];

        const xF = Math.fround(x);
        const xR = x - xF;
        vertices[vertexOffset + 0] = xF;
        vertices[vertexOffset + 1] = xR;
        const yF = Math.fround(y);
        const yR = y - yF;
        vertices[vertexOffset + 2] = yF;
        vertices[vertexOffset + 3] = yR;
        const xpF = Math.fround(xp);
        const xpR = xp - xpF;
        vertices[vertexOffset + 4] = xpF;
        vertices[vertexOffset + 5] = xpR;
        const ypF = Math.fround(yp);
        const ypR = yp - ypF;
        vertices[vertexOffset + 6] = ypF;
        vertices[vertexOffset + 7] = ypR;

        vertices[vertexOffset + 8] = line.colorFill;
        vertices[vertexOffset + 9] = line.colorStroke;
        vertices[vertexOffset + 10] = radius;

        vertexOffset += stride;
      }
    }

    return {
      bytes: vertexOffset * 4,
      instances: vertexOffset / stride,
    };
  }

  protected activate(): void {
    const gl = this.gl;
    gl.enable(gl.STENCIL_TEST);
    gl.useProgram(this.program.id);

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
    gl.enableVertexAttribArray(this.program.attributes.radius);
    gl.vertexAttribDivisor(this.program.attributes.radius, 1);
  }

  protected bind(offset: number): void {
    const gl = this.gl;

    gl.vertexAttribPointer(
        this.program.attributes.colorFill,
        1,
        gl.FLOAT,
        /* normalize= */ false,
        /* stride= */ VERTEX_STRIDE,
        /* offset= */ offset + 32);
    gl.vertexAttribPointer(
        this.program.attributes.colorStroke,
        1,
        gl.FLOAT,
        /* normalize= */ false,
        /* stride= */ VERTEX_STRIDE,
        /* offset= */ offset + 36);
    gl.vertexAttribPointer(
        this.program.attributes.previous,
        4,
        gl.FLOAT,
        /* normalize= */ false,
        /* stride= */ VERTEX_STRIDE,
        /* offset= */ offset + 0);
    gl.vertexAttribPointer(
        this.program.attributes.next,
        4,
        gl.FLOAT,
        /* normalize= */ false,
        /* stride= */ VERTEX_STRIDE,
        /* offset= */ offset + 16);
    gl.vertexAttribPointer(
        this.program.attributes.radius,
        1,
        gl.FLOAT,
        /* normalize= */ false,
        /* stride= */ VERTEX_STRIDE,
        /* offset= */ offset + 40);
  }

  protected draw(drawable: Drawable): void {
    if (drawable.instances === undefined) {
      throw new Error('Expecting instances');
    }

    const gl = this.gl;

    // Draw without the border, always replacing the stencil buffer
    gl.stencilFunc(gl.ALWAYS, 1, 0xff);
    gl.stencilMask(0xff);
    gl.uniform1i(this.program.uniforms.renderBorder, 0);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, this.program.vertexCount, drawable.instances);

    // Draw with the border only where we didn't already draw
    gl.stencilFunc(gl.NOTEQUAL, 1, 0xff);
    // Don't write to the stencil buffer so we don't overlap other lines
    gl.stencilMask(0x00);
    gl.uniform1i(this.program.uniforms.renderBorder, 1);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, this.program.vertexCount, drawable.instances);
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
    gl.vertexAttribDivisor(this.program.attributes.radius, 0);
    gl.disableVertexAttribArray(this.program.attributes.radius);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    gl.useProgram(null);
    gl.disable(gl.STENCIL_TEST);
  }
}

interface LineProgramData extends ProgramData {
  attributes: {
    colorFill: number;
    colorStroke: number;
    next: number;
    position: number;
    previous: number;
    radius: number;
  };
  uniforms: {
    cameraCenter: WebGLUniformLocation;
    halfViewportSize: WebGLUniformLocation;
    halfWorldSize: WebGLUniformLocation;
    renderBorder: WebGLUniformLocation;
  };
}

function createLineProgram(gl: WebGL2RenderingContext): LineProgramData {
  const programId = checkExists(gl.createProgram());

  const vs = `#version 300 es
      // This is a Mercator coordinate ranging from -1 to 1 on both x and y
      uniform highp vec4 cameraCenter;
      uniform highp vec2 halfViewportSize;
      uniform highp float halfWorldSize;
      uniform bool renderBorder;

      // x is either 0 or 1, y is either -1 or 1.
      in highp vec2 position;

      // These are Mercator coordinates ranging from -1 to 1 on both x and y
      in highp vec4 previous;
      in highp vec4 next;

      in highp float colorFill;
      in highp float colorStroke;
      // This is a radius in pixels
      in highp float radius;

      out lowp vec4 fragColorFill;
      out lowp vec4 fragColorStroke;
      out lowp float fragRadius;
      out lowp float fragDistanceOrtho;

      ${COLOR_OPERATIONS}
      ${FP64_OPERATIONS}

      void main() {
        vec4 direction = next - previous;
        vec4 perpendicular = perpendicular64(normalize64(direction));
        vec4 location = -cameraCenter + previous + direction * position.x;
        highp float actualRadius = radius - (renderBorder ? 0. : 2.);
        vec4 push = perpendicular * actualRadius * position.y;
        vec4 worldCoord = location * halfWorldSize + push;
        gl_Position = vec4(reduce64(divide2Into64(worldCoord, halfViewportSize)), 0, 1);

        fragColorFill = uint32FToVec4(colorFill);
        fragColorStroke = uint32FToVec4(colorStroke);
        fragRadius = radius;
        fragDistanceOrtho = position.y * actualRadius;
      }
    `;
  const fs = `#version 300 es
      uniform bool renderBorder;

      in lowp vec4 fragColorFill;
      in lowp vec4 fragColorStroke;
      in lowp float fragRadius;
      in lowp float fragDistanceOrtho;

      out lowp vec4 fragColor;

      void main() {
        mediump float o = abs(fragDistanceOrtho);
        lowp float blend = (o - 2.);
        lowp vec4 color = mix(fragColorFill, fragColorStroke, blend);
        fragColor = vec4(color.rgb, color.a * (1. - clamp(o - 3., 0., 1.)));
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
    id: programId,
    instanceSize: VERTEX_STRIDE,
    vertexCount: 4,
    attributes: {
      colorFill: checkExists(gl.getAttribLocation(programId, 'colorFill')),
      colorStroke: checkExists(gl.getAttribLocation(programId, 'colorStroke')),
      next: checkExists(gl.getAttribLocation(programId, 'next')),
      position: checkExists(gl.getAttribLocation(programId, 'position')),
      previous: checkExists(gl.getAttribLocation(programId, 'previous')),
      radius: checkExists(gl.getAttribLocation(programId, 'radius')),
    },
    uniforms: {
      cameraCenter: checkExists(gl.getUniformLocation(programId, 'cameraCenter')),
      halfViewportSize: checkExists(gl.getUniformLocation(programId, 'halfViewportSize')),
      halfWorldSize: checkExists(gl.getUniformLocation(programId, 'halfWorldSize')),
      renderBorder: checkExists(gl.getUniformLocation(programId, 'renderBorder')),
    },
  };
}

