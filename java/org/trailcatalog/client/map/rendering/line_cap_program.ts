import { checkExists } from '../../common/asserts';
import { splitVec2 } from '../../common/math';

import { Line } from './geometry';
import { Drawable, FP64_OPERATIONS, Program, ProgramData } from './program';

const CIRCLE_STEPS = 8;
const CIRCLE_VERTEX_COUNT = /* center */ 1 + CIRCLE_STEPS + /* end */ 1;
const VERTEX_STRIDE = 18 * 4;

/** Renders lines caps as instanced circles. */
export class LineCapProgram extends Program<LineCapProgramData> {

  private readonly circleBuffer: WebGLBuffer;

  constructor(gl: WebGL2RenderingContext) {
    super(createLineCapProgram(gl), gl, gl.TRIANGLE_FAN);
    const vertices = [0, 0];
    const theta = 2 * Math.PI / CIRCLE_STEPS;
    for (let i = 0; i <= CIRCLE_STEPS; i++) {
      const x = Math.cos(i * theta);
      const y = Math.sin(i * theta);
      vertices.push(x, y);
    }
    this.circleBuffer = this.createStaticBuffer(new Float32Array(vertices));
  }

  protected activate(): void {
    const gl = this.gl;

    gl.useProgram(this.program.id);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.circleBuffer);
    gl.enableVertexAttribArray(this.program.attributes.position);
    gl.vertexAttribPointer(
        this.program.attributes.position,
        2,
        gl.FLOAT,
        /* normalize= */ false,
        /* stride= */ 0,
        /* offset= */ 0);

    gl.enableVertexAttribArray(this.program.attributes.center);
    gl.vertexAttribDivisor(this.program.attributes.center, 1);
    gl.enableVertexAttribArray(this.program.attributes.colorFill);
    gl.vertexAttribDivisor(this.program.attributes.colorFill, 1);
    gl.enableVertexAttribArray(this.program.attributes.colorStroke);
    gl.vertexAttribDivisor(this.program.attributes.colorStroke, 1);
    gl.enableVertexAttribArray(this.program.attributes.radius);
    gl.vertexAttribDivisor(this.program.attributes.radius, 1);
  }

  protected bind(offset: number): void {
    const gl = this.gl;

    // These must match LineProgram, because we parasitize that geometry
    gl.vertexAttribPointer(
        this.program.attributes.center,
        4,
        gl.FLOAT,
        /* normalize= */ false,
        VERTEX_STRIDE,
        /* offset= */ offset + 0);
    gl.vertexAttribPointer(
        this.program.attributes.colorFill,
        4,
        gl.FLOAT,
        /* normalize= */ false,
        VERTEX_STRIDE,
        /* offset= */ offset + 32);
    gl.vertexAttribPointer(
        this.program.attributes.colorStroke,
        4,
        gl.FLOAT,
        /* normalize= */ false,
        VERTEX_STRIDE,
        /* offset= */ offset + 48);
    gl.vertexAttribPointer(
        this.program.attributes.radius,
        1,
        gl.FLOAT,
        /* normalize= */ false,
        VERTEX_STRIDE,
        /* offset= */ offset + 68);
  }

  protected deactivate(): void {
    const gl = this.gl;

    gl.disableVertexAttribArray(this.program.attributes.position);

    gl.vertexAttribDivisor(this.program.attributes.center, 0);
    gl.disableVertexAttribArray(this.program.attributes.center);
    gl.vertexAttribDivisor(this.program.attributes.colorFill, 0);
    gl.disableVertexAttribArray(this.program.attributes.colorFill);
    gl.vertexAttribDivisor(this.program.attributes.colorStroke, 0);
    gl.disableVertexAttribArray(this.program.attributes.colorStroke);
    gl.vertexAttribDivisor(this.program.attributes.radius, 0);
    gl.disableVertexAttribArray(this.program.attributes.radius);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    gl.useProgram(null);
  }
}

interface LineCapProgramData extends ProgramData {
  attributes: {
    center: number;
    colorFill: number;
    colorStroke: number;
    position: number;
    radius: number;
  }
}

function createLineCapProgram(gl: WebGL2RenderingContext): LineCapProgramData {
  const programId = checkExists(gl.createProgram());

  const vs = `#version 300 es
      // This is a Mercator coordinate ranging from -1 to 1 on both x and y
      uniform highp vec4 cameraCenter;
      uniform highp vec2 halfViewportSize;
      uniform highp float halfWorldSize;

      // The position of the vertex in the unit circle
      in highp vec2 position;

      // This is a Mercator coordinate ranging from -1 to 1 on both x and y
      in highp vec4 center;

      in lowp vec4 colorFill;
      in lowp vec4 colorStroke;
      // This is a radius in pixels
      in highp float radius;

      out lowp vec4 fragColorFill;
      out lowp vec4 fragColorStroke;
      out highp float fragRadius;
      out highp float fragDistanceOrtho;

      ${FP64_OPERATIONS}

      void main() {
        vec4 location = -cameraCenter + center;
        vec4 worldCoord =
            location * halfWorldSize + vec4(position.x, 0, position.y, 0) * radius;
        gl_Position = vec4(reduce64(divide2Into64(worldCoord, halfViewportSize)), 0, 1);

        fragColorFill = colorFill;
        fragColorStroke = colorStroke;
        fragRadius = radius;
        fragDistanceOrtho = gl_VertexID == 0 ? 0. : radius;
      }
    `;
  const fs = `#version 300 es

      in lowp vec4 fragColorFill;
      in lowp vec4 fragColorStroke;
      in lowp float fragRadius;
      in highp float fragDistanceOrtho;

      out lowp vec4 fragColor;

      void main() {
        mediump float o = abs(fragDistanceOrtho);
        mediump vec4 color = mix(fragColorFill, fragColorStroke, o / fragRadius);
        mediump float alpha = o < fragRadius - 0.5 ? 1. : 2. * (fragRadius - o);
        fragColor = vec4(color.rgb, mix(0., color.a, alpha));
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
    // These must match LineProgram, because we parasitize that geometry
    instanceSize: VERTEX_STRIDE,
    vertexCount: CIRCLE_VERTEX_COUNT,
    attributes: {
      center: checkExists(gl.getAttribLocation(programId, 'center')),
      colorFill: checkExists(gl.getAttribLocation(programId, 'colorFill')),
      colorStroke: checkExists(gl.getAttribLocation(programId, 'colorStroke')),
      position: checkExists(gl.getAttribLocation(programId, 'position')),
      radius: checkExists(gl.getAttribLocation(programId, 'radius')),
    },
    uniforms: {
      cameraCenter: checkExists(gl.getUniformLocation(programId, 'cameraCenter')),
      halfViewportSize: checkExists(gl.getUniformLocation(programId, 'halfViewportSize')),
      halfWorldSize: checkExists(gl.getUniformLocation(programId, 'halfWorldSize')),
    },
  };
}

