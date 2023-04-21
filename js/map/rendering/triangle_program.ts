import { checkExists } from 'js/common/asserts';

import { RgbaU32, Vec2 } from '../common/types';

import { COLOR_OPERATIONS, Drawable, FP64_OPERATIONS, Program, ProgramData } from './program';

interface TriangleDrawable {
  elements: {
    bytes: number;
    count: number;
  };
  fill: RgbaU32;
}

export const VERTEX_STRIDE =
    4 * (
        /* position= */ 4
    );

export class TriangleProgram extends Program<TriangleProgramData> {

  constructor(gl: WebGL2RenderingContext) {
    super(createTriangleProgram(gl), gl, gl.TRIANGLES);
  }

  plan(
      indices: ArrayLike<number>,
      vertices: Float32Array|Float64Array,
      fill: RgbaU32,
      buffer: ArrayBuffer,
      bufferOffset: number): TriangleDrawable {
    const floats = new Float32Array(buffer, bufferOffset);
    // Values that may represent NaN floats (colors) cannot be written as floats due to NaN
    // canonicalization. So we have to write them as uints to the same buffer.
    const uint32s = new Uint32Array(buffer, bufferOffset);

    let vertexOffset = 0;
    for (let i = 0; i < vertices.length; i += 2) {
      const xF = Math.fround(vertices[i + 0]);
      const xR = vertices[i + 0] - xF;
      floats[vertexOffset + 0] = xF;
      floats[vertexOffset + 1] = xR;
      const yF = Math.fround(vertices[i + 1]);
      const yR = vertices[i + 1] - yF;
      floats[vertexOffset + 2] = yF;
      floats[vertexOffset + 3] = yR;

      vertexOffset += VERTEX_STRIDE / 4;
    }

    return {
      elements: {
        bytes: vertexOffset * 4,
        count: indices.length,
      },
      fill,
    };
  }

  protected activate(): void {
    const gl = this.gl;

    gl.useProgram(this.program.id);

    gl.enableVertexAttribArray(this.program.attributes.position);
  }

  protected bind(offset: number): void {
    const gl = this.gl;

    gl.vertexAttribPointer(
        this.program.attributes.position,
        4,
        gl.FLOAT,
        /* normalize= */ false,
        /* stride= */ VERTEX_STRIDE,
        /* offset= */ offset);
  }

  protected draw(drawable: Drawable): void {
    const gl = this.gl;

    gl.uniform1ui(this.program.uniforms.fillColor, drawable.fill ?? 0);
    super.draw(drawable);
  }

  protected deactivate(): void {
    const gl = this.gl;

    gl.disableVertexAttribArray(this.program.attributes.position);

    gl.useProgram(null);
  }
}

interface TriangleProgramData extends ProgramData {
  id: WebGLProgram;

  attributes: {
    position: number;
  };

  uniforms: {
    cameraCenter: WebGLUniformLocation;
    halfViewportSize: WebGLUniformLocation;
    halfWorldSize: WebGLUniformLocation;
    fillColor: WebGLUniformLocation;
  };
}

function createTriangleProgram(gl: WebGL2RenderingContext): TriangleProgramData {
  const programId = checkExists(gl.createProgram());

  const vs = `#version 300 es

      // Mercator coordinates range from -1 to 1 on both x and y
      // Pixels are in screen space (eg -320px to 320px for a 640px width)

      uniform highp vec4 cameraCenter; // Mercator
      uniform highp vec2 halfViewportSize; // pixels
      uniform highp float halfWorldSize; // pixels
      uniform uint fillColor;

      in highp vec4 position; // Mercator

      out mediump vec4 fragFillColor;

      ${COLOR_OPERATIONS}
      ${FP64_OPERATIONS}

      void main() {
        // This is a load bearing ternary operator: it seems to defeat some bad optimizations that
        // reduce our float precision.
        vec4 alwaysCameraCenter = position.x < 1000.0 ? cameraCenter : position;
        vec4 relativeCenter = position - alwaysCameraCenter;
        vec2 screenCoord = reduce64(relativeCenter * halfWorldSize);
        gl_Position = vec4(screenCoord / halfViewportSize, 0, 1);

        fragFillColor = uint32ToVec4(fillColor);
        fragFillColor = vec4(fragFillColor.rgb * fragFillColor.a, fragFillColor.a);
      }
    `;
  const fs = `#version 300 es

      in mediump vec4 fragFillColor;

      out mediump vec4 fragColor;

      void main() {
        fragColor = fragFillColor;
      }
  `;

  const vertexId = checkExists(gl.createShader(gl.VERTEX_SHADER));
  gl.shaderSource(vertexId, vs);
  gl.compileShader(vertexId);
  if (!gl.getShaderParameter(vertexId, gl.COMPILE_STATUS)) {
    throw new Error(`Unable to compile triangle vertex shader: ${gl.getShaderInfoLog(vertexId)}`);
  }
  gl.attachShader(programId, vertexId);

  const fragmentId = checkExists(gl.createShader(gl.FRAGMENT_SHADER));
  gl.shaderSource(fragmentId, fs);
  gl.compileShader(fragmentId);
  if (!gl.getShaderParameter(fragmentId, gl.COMPILE_STATUS)) {
    throw new Error(`Unable to compile triangle fragment shader: ${gl.getShaderInfoLog(fragmentId)}`);
  }
  gl.attachShader(programId, fragmentId);

  gl.linkProgram(programId);
  if (!gl.getProgramParameter(programId, gl.LINK_STATUS)) {
    throw new Error(`Unable to link triangle program: ${gl.getProgramInfoLog(programId)}`);
  }

  return {
    id: programId,
    attributes: {
      position: gl.getAttribLocation(programId, 'position'),
    },
    uniforms: {
      cameraCenter: checkExists(gl.getUniformLocation(programId, 'cameraCenter')),
      halfViewportSize: checkExists(gl.getUniformLocation(programId, 'halfViewportSize')),
      halfWorldSize: checkExists(gl.getUniformLocation(programId, 'halfWorldSize')),
      fillColor: checkExists(gl.getUniformLocation(programId, 'fillColor')),
    },
    vertexCount: -1,
  };
}
