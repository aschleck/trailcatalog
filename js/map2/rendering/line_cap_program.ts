import { checkExists } from 'js/common/asserts';

import { RgbaU32 } from '../common/types';

import { COLOR_OPERATIONS, Drawable, Program, ProgramData } from './program';
import { VERTEX_STRIDE } from './line_program';

const CIRCLE_STEPS = 8;
const CIRCLE_VERTEX_COUNT = /* center */ 1 + CIRCLE_STEPS + /* end */ 1;

/** Renders circles at line joins to make lines round. */
export class LineCapProgram extends Program<LineCapProgramData> {

  private readonly circleBuffer: WebGLBuffer;

  constructor(gl: WebGL2RenderingContext) {
    super(createLineCapProgram(gl), gl, gl.TRIANGLE_FAN);

    this.circleBuffer = checkExists(gl.createBuffer());
    this.registerDisposer(() => {
      gl.deleteBuffer(this.circleBuffer);
    });

    const vertices = [0, 0];
    const theta = 2 * Math.PI / CIRCLE_STEPS;
    for (let i = 0; i <= CIRCLE_STEPS; i++) {
      const x = Math.cos(i * theta);
      const y = Math.sin(i * theta);
      vertices.push(x, y);
    }
    gl.bindBuffer(gl.COPY_WRITE_BUFFER, this.circleBuffer);
    gl.bufferData(gl.COPY_WRITE_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);
    gl.bindBuffer(gl.COPY_WRITE_BUFFER, null);
  }

  protected activate(): void {
    const gl = this.gl;
    gl.enable(gl.STENCIL_TEST);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.circleBuffer);
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

    // Draw without the border, always replacing the stencil buffer if we're replacing
    gl.stencilFunc(gl.GREATER, drawable.z, 0xff);
    gl.stencilMask(0xff);
    gl.uniform1i(this.program.uniforms.renderBorder, 0);
    gl.uniform1ui(this.program.uniforms.side, 0);
    gl.drawArraysInstanced(gl.TRIANGLE_FAN, 0, CIRCLE_VERTEX_COUNT, drawable.instanced.count);
    gl.uniform1ui(this.program.uniforms.side, 1);
    gl.drawArraysInstanced(gl.TRIANGLE_FAN, 0, CIRCLE_VERTEX_COUNT, drawable.instanced.count);

    // Don't write to the stencil buffer so we don't block line caps
    gl.stencilMask(0x00);
    gl.uniform1i(this.program.uniforms.renderBorder, 1);
    gl.drawArraysInstanced(gl.TRIANGLE_FAN, 0, CIRCLE_VERTEX_COUNT, drawable.instanced.count);
    gl.uniform1ui(this.program.uniforms.side, 0);
    gl.drawArraysInstanced(gl.TRIANGLE_FAN, 0, CIRCLE_VERTEX_COUNT, drawable.instanced.count);
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
    gl.disable(gl.STENCIL_TEST);
  }
}

interface LineCapProgramData extends ProgramData {
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
    side: WebGLUniformLocation;
    z: WebGLUniformLocation;
  };
}

function createLineCapProgram(gl: WebGL2RenderingContext): LineCapProgramData {
  const programId = checkExists(gl.createProgram());

  const vs = `#version 300 es
      // This is a Mercator coordinate ranging from -1 to 1 on both x and y
      uniform highp vec2 cameraCenter;
      uniform highp vec2 halfViewportSize;
      uniform highp float halfWorldSize;
      uniform bool renderBorder;
      uniform uint side;
      uniform highp float z;

      // either [0, 0] or x^2 + y^2 = 1
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

      out lowp vec4 fragColorFill;
      out lowp vec4 fragColorStroke;
      out lowp float fragDistanceAlong;
      out lowp float fragRadius;
      out lowp float fragStipple;
      out lowp float fragDistanceOrtho;

      ${COLOR_OPERATIONS}

      void main() {
        // This is a load bearing ternary operator: it seems to defeat some bad optimizations that
        // reduce our float precision.
        vec2 center = side == 0u ? previous : next;
        vec2 direction = next - previous;
        vec2 location = -cameraCenter + center;
        highp float actualRadius = renderBorder ? radius : radius - 1.;
        vec2 push = actualRadius * position;
        vec2 worldCoord = location * halfWorldSize + push;
        gl_Position = vec4(worldCoord / halfViewportSize, z, 1);

        fragColorFill = uint32FToVec4(colorFill);
        fragColorStroke = uint32FToVec4(colorStroke);
        // We want to avoid stipples "dancing" as zoom changes, so we make this more of a step
        // change.
        fragDistanceAlong =
            exp2(floor(2. * log2(halfWorldSize)) / 2.)
                * (distanceAlong + position.x * length(direction));
        fragDistanceOrtho = actualRadius;
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
    throw new Error(`Unable to compile line cap vertex shader: ${gl.getShaderInfoLog(vertexId)}`);
  }
  gl.attachShader(programId, vertexId);

  const fragmentId = checkExists(gl.createShader(gl.FRAGMENT_SHADER));
  gl.shaderSource(fragmentId, fs);
  gl.compileShader(fragmentId);
  if (!gl.getShaderParameter(fragmentId, gl.COMPILE_STATUS)) {
    throw new Error(`Unable to compile line cap fragment shader: ${gl.getShaderInfoLog(fragmentId)}`);
  }
  gl.attachShader(programId, fragmentId);

  gl.linkProgram(programId);
  if (!gl.getProgramParameter(programId, gl.LINK_STATUS)) {
    throw new Error(`Unable to link line cap program: ${gl.getProgramInfoLog(programId)}`);
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
      side: checkExists(gl.getUniformLocation(programId, 'side')),
      z: checkExists(gl.getUniformLocation(programId, 'z')),
    },
  };
}

