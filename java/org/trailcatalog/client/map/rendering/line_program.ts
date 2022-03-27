import { checkExists } from '../../common/asserts';
import { splitVec2 } from '../../common/math';

import { FP64_OPERATIONS, Program, ProgramData } from './program';

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

  protected activate(): void {
    const gl = this.gl;

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
    gl.enableVertexAttribArray(this.program.attributes.colorStipple);
    gl.vertexAttribDivisor(this.program.attributes.colorStipple, 1);
    gl.enableVertexAttribArray(this.program.attributes.distanceAlong);
    gl.vertexAttribDivisor(this.program.attributes.distanceAlong, 1);
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
        4,
        gl.FLOAT,
        /* normalize= */ false,
        /* stride= */ 18 * 4,
        /* offset= */ offset + 32);
    gl.vertexAttribPointer(
        this.program.attributes.colorStipple,
        4,
        gl.FLOAT,
        /* normalize= */ false,
        /* stride= */ 18 * 4,
        /* offset= */ offset + 48);
    gl.vertexAttribPointer(
        this.program.attributes.distanceAlong,
        1,
        gl.FLOAT,
        /* normalize= */ false,
        /* stride= */ 18 * 4,
        /* offset= */ offset + 64);
    gl.vertexAttribPointer(
        this.program.attributes.previous,
        4,
        gl.FLOAT,
        /* normalize= */ false,
        /* stride= */ 18 * 4,
        /* offset= */ offset + 0);
    gl.vertexAttribPointer(
        this.program.attributes.next,
        4,
        gl.FLOAT,
        /* normalize= */ false,
        /* stride= */ 18 * 4,
        /* offset= */ offset + 16);
    gl.vertexAttribPointer(
        this.program.attributes.radius,
        1,
        gl.FLOAT,
        /* normalize= */ false,
        /* stride= */ 18 * 4,
        /* offset= */ offset + 68);
  }

  protected deactivate(): void {
    const gl = this.gl;

    gl.disableVertexAttribArray(this.program.attributes.position);

    gl.vertexAttribDivisor(this.program.attributes.colorFill, 0);
    gl.disableVertexAttribArray(this.program.attributes.colorFill);
    gl.vertexAttribDivisor(this.program.attributes.colorStipple, 0);
    gl.disableVertexAttribArray(this.program.attributes.colorStipple);
    gl.vertexAttribDivisor(this.program.attributes.distanceAlong, 0);
    gl.disableVertexAttribArray(this.program.attributes.distanceAlong);
    gl.vertexAttribDivisor(this.program.attributes.previous, 0);
    gl.disableVertexAttribArray(this.program.attributes.previous);
    gl.vertexAttribDivisor(this.program.attributes.next, 0);
    gl.disableVertexAttribArray(this.program.attributes.next);
    gl.vertexAttribDivisor(this.program.attributes.radius, 0);
    gl.disableVertexAttribArray(this.program.attributes.radius);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    gl.useProgram(null);
  }
}

interface LineProgramData extends ProgramData {
  attributes: {
    colorFill: number;
    colorStipple: number;
    distanceAlong: number;
    next: number;
    position: number;
    previous: number;
    radius: number;
  }
}

function createLineProgram(gl: WebGL2RenderingContext): LineProgramData {
  const programId = checkExists(gl.createProgram());

  const vs = `#version 300 es
      // This is a Mercator coordinate ranging from -1 to 1 on both x and y
      uniform highp vec4 cameraCenter;
      uniform highp vec2 halfViewportSize;
      uniform highp float halfWorldSize;

      // x is either 0 or 1, y is either -0.5 or 0.5.
      in highp vec2 position;

      // These are Mercator coordinates ranging from -1 to 1 on both x and y
      in highp vec4 previous;
      in highp float distanceAlong;
      in highp vec4 next;

      in lowp vec4 colorFill;
      in lowp vec4 colorStipple;
      // This is a radius in pixels
      in highp float radius;

      out lowp vec4 fragColorFill;
      out lowp vec4 fragColorStipple;
      out highp float fragDistanceAlong;
      out highp float fragDistanceOrtho;

      ${FP64_OPERATIONS}

      void main() {
        vec4 direction = next - previous;
        vec4 perpendicular = perpendicular64(normalize64(direction));
        vec4 location = -cameraCenter + previous + direction * position.x;
        vec4 worldCoord = location * halfWorldSize + perpendicular * radius * position.y;
        gl_Position = vec4(reduce64(divide2Into64(worldCoord, halfViewportSize)), 0, 1);

        float worldDistanceAlong = distanceAlong + magnitude64(direction) * position.x;
        fragDistanceAlong = 256. * pow(2., 17.) * worldDistanceAlong;
        fragDistanceAlong = halfWorldSize * worldDistanceAlong;

        fragColorFill = colorFill;
        fragColorStipple = colorStipple;
        fragDistanceOrtho = position.y * radius;
      }
    `;
  const fs = `#version 300 es
      #define PI 3.14159265359

      in lowp vec4 fragColorFill;
      in lowp vec4 fragColorStipple;
      in highp float fragDistanceAlong;
      in highp float fragDistanceOrtho;

      out lowp vec4 fragColor;

      void main() {
        lowp float stippleX = float(mod(fragDistanceAlong, 8.) >= 3.);
        lowp float stippleY = float(2. > abs(fragDistanceOrtho)) * (2. - abs(fragDistanceOrtho / 1.5));
        lowp vec4 stipple = vec4(fragColorStipple.xyz, stippleX * stippleY * fragColorStipple.w);
        fragColor = (1. - stipple.w) * fragColorFill + stipple.w * stipple;
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
    instanceSize: 18 * 4,
    vertexCount: 4,
    attributes: {
      colorFill: checkExists(gl.getAttribLocation(programId, 'colorFill')),
      colorStipple: checkExists(gl.getAttribLocation(programId, 'colorStipple')),
      distanceAlong: gl.getAttribLocation(programId, 'distanceAlong'),
      next: gl.getAttribLocation(programId, 'next'),
      position: gl.getAttribLocation(programId, 'position'),
      previous: gl.getAttribLocation(programId, 'previous'),
      radius: gl.getAttribLocation(programId, 'radius'),
    },
    uniforms: {
      cameraCenter: checkExists(gl.getUniformLocation(programId, 'cameraCenter')),
      halfViewportSize: checkExists(gl.getUniformLocation(programId, 'halfViewportSize')),
      halfWorldSize: checkExists(gl.getUniformLocation(programId, 'halfWorldSize')),
    },
  };
}

