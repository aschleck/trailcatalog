import { checkExists } from 'external/dev_april_corgi+/js/common/asserts';

import { RgbaU32, Vec2 } from '../common/types';

import {
  COLOR_OPERATIONS,
  Drawable,
  encodeLow,
  FP64_OPERATIONS,
  getStandardUniforms,
  linkProgram,
  Program,
  ProgramData,
  SPHERE_OPERATIONS,
} from './program';

// A fill color comes first, then the vertices, each a float32 x,y and their int16 lows.
const FILL_BYTES = 4;
const VERTEX_STRIDE = 4 * 2 + 2 * 2;

export class TriangleProgram extends Program<TriangleProgramData> {

  /** Bytes that {@link push} will write for a fill of the given vertex count. */
  static bytesNeeded(vertexCount: number): number {
    return FILL_BYTES + vertexCount * VERTEX_STRIDE;
  }

  /** Writes a fill color that the vertices pushed after it, up to the drawable's end, share. */
  static pushFill(fill: RgbaU32, buffer: ArrayBuffer, offset: number): number {
    new Uint32Array(buffer, offset, 1)[0] = fill;
    return FILL_BYTES;
  }

  /** Writes mercator x,y pairs as vertices and returns the bytes written. */
  static pushVertices(geometry: ArrayLike<number>, buffer: ArrayBuffer, offset: number): number {
    const count = geometry.length / 2;
    const floats = new Float32Array(buffer, offset, count * VERTEX_STRIDE / 4);
    const int16s = new Int16Array(buffer, offset, count * VERTEX_STRIDE / 2);
    for (let i = 0; i < count; ++i) {
      const x = geometry[2 * i + 0];
      const y = geometry[2 * i + 1];
      floats[3 * i + 0] = x;
      floats[3 * i + 1] = y;
      int16s[6 * i + 4] = encodeLow(x);
      int16s[6 * i + 5] = encodeLow(y);
    }
    return count * VERTEX_STRIDE;
  }

  static push(
      geometry: ArrayLike<number>,
      index: ArrayLike<number>,
      fill: RgbaU32,
      geometryBuffer: ArrayBuffer,
      geometryOffset: number,
      indexBuffer: ArrayBuffer,
      indexOffset: number,
  ): {
    geometryByteLength: number;
    geometryOffset: number;
    indexByteLength: number;
    indexOffset: number;
    elementCount: number,
  } {
    const indices = new Uint32Array(indexBuffer, indexOffset, index.length);
    indices.set(index, 0);

    const fillBytes = TriangleProgram.pushFill(fill, geometryBuffer, geometryOffset);
    const vertexBytes =
        TriangleProgram.pushVertices(geometry, geometryBuffer, geometryOffset + fillBytes);

    return {
      geometryByteLength: fillBytes + vertexBytes,
      geometryOffset,
      indexByteLength: index.length * 4,
      indexOffset,
      elementCount: index.length,
    };
  }

  constructor(gl: WebGL2RenderingContext) {
    super(createTriangleProgram(gl), gl, gl.TRIANGLES);
  }

  plan(
      geometry: ArrayLike<number>,
      index: ArrayLike<number>,
      fill: RgbaU32,
      z: number,
      geometryBuffer: ArrayBuffer,
      geometryOffset: number,
      indexBuffer: ArrayBuffer,
      indexOffset: number,
      glGeometryBuffer: WebGLBuffer,
      glIndexBuffer: WebGLBuffer,
  ): Drawable {
    const result =
        TriangleProgram.push(
            geometry,
            index,
            fill,
            geometryBuffer,
            geometryOffset,
            indexBuffer,
            indexOffset);

    return {
      elements: {
        count: result.elementCount,
        index: glIndexBuffer,
        offset: result.indexOffset,
      },
      geometry: glGeometryBuffer,
      geometryByteLength: result.geometryByteLength,
      geometryOffset: result.geometryOffset,
      instanced: undefined,
      program: this,
      texture: undefined,
      vertexCount: undefined,
      z,
    };
  }

  protected activate(): void {
    const gl = this.gl;

    gl.enableVertexAttribArray(this.program.attributes.fillColor);
    gl.vertexAttribDivisor(this.program.attributes.fillColor, 1);
    gl.enableVertexAttribArray(this.program.attributes.position);
    gl.enableVertexAttribArray(this.program.attributes.positionLow);
  }

  protected bindAttributes(offset: number): void {
    const gl = this.gl;

    gl.vertexAttribIPointer(
        this.program.attributes.fillColor,
        1,
        gl.UNSIGNED_INT,
        /* stride= */ 0,
        /* offset= */ offset + 0);
    gl.vertexAttribPointer(
        this.program.attributes.position,
        2,
        gl.FLOAT,
        /* normalize= */ false,
        /* stride= */ VERTEX_STRIDE,
        /* offset= */ offset + FILL_BYTES);
    gl.vertexAttribPointer(
        this.program.attributes.positionLow,
        2,
        gl.SHORT,
        /* normalize= */ true,
        /* stride= */ VERTEX_STRIDE,
        /* offset= */ offset + FILL_BYTES + 8);
  }

  protected deactivate(): void {
    const gl = this.gl;

    gl.vertexAttribDivisor(this.program.attributes.fillColor, 0);
    gl.disableVertexAttribArray(this.program.attributes.fillColor);
    gl.disableVertexAttribArray(this.program.attributes.position);
    gl.disableVertexAttribArray(this.program.attributes.positionLow);
  }
}

interface TriangleProgramData extends ProgramData {
  attributes: {
    fillColor: number;
    position: number;
    positionLow: number;
  };
}

function createTriangleProgram(gl: WebGL2RenderingContext): TriangleProgramData {
  const vs = `#version 300 es

      // Mercator coordinates range from -1 to 1 on both x and y
      // Pixels are in screen space (eg -320px to 320px for a 640px width)

      uniform highp vec4 cameraCenter; // Mercator
      uniform mediump float flattenFactor; // 0 to 1
      uniform highp float halfWorldSize; // pixels
      uniform highp vec2 inverseHalfViewportSize; // 1/pixels
      uniform highp mat4 sphericalMvp;
      uniform highp float z;

      in uint fillColor;
      in highp vec2 position; // Mercator
      in highp vec2 positionLow; // see program.ts#encodeLow

      // See https://github.com/visgl/luma.gl/issues/1764
      invariant gl_Position;

      out mediump vec4 fragFillColor;
      out mediump float fragBehindHorizon;

      ${COLOR_OPERATIONS}
      ${FP64_OPERATIONS}
      ${SPHERE_OPERATIONS}

      void main() {
        // Calculate the Mercator projection
        vec4 relativeCenter = sub_fp64(withLow(position, positionLow), cameraCenter);
        if (relativeCenter.x + relativeCenter.y > 1.) {
          relativeCenter.x -= 2.;
        } else if (relativeCenter.x + relativeCenter.y < -1.) {
          relativeCenter.x += 2.;
        }
        // Only the camera subtraction needs fp64, see line_program.ts.
        vec2 relative =
            vec2(relativeCenter.x + relativeCenter.y, relativeCenter.z + relativeCenter.w);
        vec2 p = relative * halfWorldSize * inverseHalfViewportSize;
        vec4 mercator = vec4(p, -1, 1);

        // sphereFromMercator and horizonDistance each cost a tanh, an asin, and four more
        // transcendentals, and mix discards all of it once flattenFactor reaches 1. flattenFactor
        // is a uniform, so the branch is coherent across the draw.
        vec4 spherical = vec4(0.);
        highp float behindHorizon = 1.;
        if (flattenFactor < 1.) {
          vec3 spherePos = sphereFromMercator(position);
          spherical = sphericalMvp * vec4(spherePos, 1.0);

          // Signed horizon distance for fragment-level cull on the back of the globe. The far
          // plane sits just past the visible cap, so back-side triangles get clipped to the
          // far-plane disc and land at the same depth as the skybox, and the depth test alone
          // doesn't hide them. See sdf_program for the equivalent label-level cull.
          behindHorizon = horizonDistance(spherePos);
        }

        gl_Position = mix(spherical, mercator, flattenFactor);
        gl_Position /= gl_Position.w;
        // Depth is the layer alone so polygons in one layer paint in draw order and transparent ones
        // blend prettily. Geometric depth would sort land and water by how far their flat triangles
        // sag from the globe, which tears land out near the limb. fragBehindHorizon culls the back
        // of the globe instead.
        gl_Position.z = 1. - 2. * z;

        fragBehindHorizon = behindHorizon;

        fragFillColor = uint32ToVec4(fillColor);
        fragFillColor = vec4(fragFillColor.rgb * fragFillColor.a, fragFillColor.a);
      }
    `;
  const fs = `#version 300 es

      uniform mediump float flattenFactor;

      in mediump vec4 fragFillColor;
      in mediump float fragBehindHorizon;

      out mediump vec4 fragColor;

      void main() {
        if (flattenFactor < 1.0 && fragBehindHorizon < 0.0) {
          discard;
        }
        fragColor = fragFillColor;
      }
  `;

  const programId = linkProgram(gl, vs, fs, 'triangle');

  return {
    handle: programId,
    attributes: {
      fillColor: gl.getAttribLocation(programId, 'fillColor'),
      position: gl.getAttribLocation(programId, 'position'),
      positionLow: gl.getAttribLocation(programId, 'positionLow'),
    },
    uniforms: getStandardUniforms(gl, programId),
  };
}
