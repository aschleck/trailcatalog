import { checkExists } from 'external/dev_april_corgi+/js/common/asserts';

import { RgbaU32 } from '../common/types';

import { COLOR_OPERATIONS, Drawable, FP64_OPERATIONS, Program, ProgramData } from './program';
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

    // Draw without the border
    gl.uniform1i(this.program.uniforms.renderBorder, 0);
    gl.uniform1ui(this.program.uniforms.side, 0);
    gl.drawArraysInstanced(gl.TRIANGLE_FAN, 0, CIRCLE_VERTEX_COUNT, drawable.instanced.count);
    gl.uniform1ui(this.program.uniforms.side, 1);
    gl.drawArraysInstanced(gl.TRIANGLE_FAN, 0, CIRCLE_VERTEX_COUNT, drawable.instanced.count);

    // Lower the z slightly so we draw under fill
    gl.uniform1f(this.program.uniforms.z, (drawable.z - 0.1) / 1000);
    gl.uniform1i(this.program.uniforms.renderBorder, 1);
    gl.drawArraysInstanced(gl.TRIANGLE_FAN, 0, CIRCLE_VERTEX_COUNT, drawable.instanced.count);
    gl.uniform1ui(this.program.uniforms.side, 0);
    gl.drawArraysInstanced(gl.TRIANGLE_FAN, 0, CIRCLE_VERTEX_COUNT, drawable.instanced.count);
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
    flattenFactor: WebGLUniformLocation;
    halfWorldSize: WebGLUniformLocation;
    inverseHalfViewportSize: WebGLUniformLocation;
    renderBorder: WebGLUniformLocation;
    side: WebGLUniformLocation;
    sphericalMvp: WebGLUniformLocation;
    z: WebGLUniformLocation;
  };
}

function createLineCapProgram(gl: WebGL2RenderingContext): LineCapProgramData {
  const programId = checkExists(gl.createProgram());

  const vs = `#version 300 es
      // This is a Mercator coordinate ranging from -1 to 1 on both x and y
      uniform highp vec4 cameraCenter;
      uniform mediump float flattenFactor; // 0 to 1
      uniform highp float halfWorldSize;
      uniform highp vec2 inverseHalfViewportSize;
      uniform bool renderBorder;
      uniform uint side;
      uniform highp mat4 sphericalMvp;
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

      // See https://github.com/visgl/luma.gl/issues/1764
      invariant gl_Position;

      out lowp vec4 fragColorFill;
      out lowp vec4 fragColorStroke;
      out lowp float fragDistanceAlong;
      out lowp float fragRadius;
      out lowp float fragStipple;
      out lowp float fragDistanceOrtho;

      ${COLOR_OPERATIONS}
      ${FP64_OPERATIONS}

      const float PI = 3.141592653589793;

      void main() {
        vec2 center = side == 0u ? previous : next;
        vec2 direction = next - previous;
        vec4 location = sub_fp64(split(center), cameraCenter);
        if (location.x + location.y > 1.) {
          location.x -= 2.;
        } else if (location.x + location.y < -1.) {
          location.x += 2.;
        }
        highp float actualRadius = renderBorder ? radius : radius - 1.;
        vec2 push = actualRadius * position;
        vec4 worldCoord =
            sum_fp64(
                mul_fp64(location, vec4(split(halfWorldSize), split(halfWorldSize))),
                split(push));
        vec4 p = mul_fp64(worldCoord, split(inverseHalfViewportSize));
        vec4 mercator = vec4(p.x + p.y, p.z + p.w, -1, 1);

        // Calculate the spherical projection
        float sinLat = tanh(center.y * PI);
        float lat = asin(sinLat);
        float cosLat = cos(lat);
        float lng = center.x * PI;
        vec4 spherical = sphericalMvp * vec4(
            cosLat * cos(lng), // x
            sinLat,            // y
            cosLat * sin(lng), // z
            1.0                // w
        );
        spherical.xy += push * inverseHalfViewportSize * spherical.w;

        gl_Position = mix(spherical, mercator, flattenFactor);
        gl_Position /= gl_Position.w;
        gl_Position.z = z * gl_Position.z + 1.;

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
      flattenFactor: checkExists(gl.getUniformLocation(programId, 'flattenFactor')),
      halfWorldSize: checkExists(gl.getUniformLocation(programId, 'halfWorldSize')),
      inverseHalfViewportSize:
        checkExists(gl.getUniformLocation(programId, 'inverseHalfViewportSize')),
      renderBorder: checkExists(gl.getUniformLocation(programId, 'renderBorder')),
      sphericalMvp: checkExists(gl.getUniformLocation(programId, 'sphericalMvp')),
      side: checkExists(gl.getUniformLocation(programId, 'side')),
      z: checkExists(gl.getUniformLocation(programId, 'z')),
    },
  };
}

