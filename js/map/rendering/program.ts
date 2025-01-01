import { checkExists } from 'external/dev_april_corgi+/js/common/asserts';
import { Disposable } from 'external/dev_april_corgi+/js/common/disposable';
import { clamp } from 'external/dev_april_corgi+/js/common/math';

import { RgbaU32, Vec2 } from '../common/types';

export interface Drawable {
  readonly elements: {
    count: number;
    index: WebGLBuffer;
    offset: number;
  }|undefined;
  readonly geometry: WebGLBuffer;
  readonly geometryByteLength: number;
  readonly geometryOffset: number;
  readonly instanced: {
    count: number;
  }|undefined,
  readonly program: Program<ProgramData>;
  readonly texture: WebGLTexture|undefined;
  readonly vertexCount: number|undefined;
  readonly z: number;
}

export interface ProgramData {
  readonly handle: WebGLProgram;

  readonly uniforms: {
    cameraCenter: WebGLUniformLocation;
    flattenFactor: WebGLUniformLocation;
    halfWorldSize: WebGLUniformLocation;
    inverseHalfViewportSize: WebGLUniformLocation;
    sphericalMvp: WebGLUniformLocation;
    z: WebGLUniformLocation;
  };
}

let nextProgramId = 0;

export abstract class Program<P extends ProgramData> extends Disposable {

  readonly id: number;

  constructor(
      protected readonly program: P,
      protected readonly gl: WebGL2RenderingContext,
      private readonly geometryType: number,
  ) {
    super();
    this.id = nextProgramId;
    nextProgramId += 1;
  }

  render(
    drawables: Drawable[],
    inverseArea: Vec2,
    centerPixel: Vec2,
    sphericalMvp: Float32Array,
    worldRadius: number,
  ): void {
    const gl = this.gl;

    gl.useProgram(this.program.handle);
    gl.uniform1f(this.program.uniforms.flattenFactor, clamp((worldRadius - 65536) / 32768, 0, 1));
    gl.uniform1f(this.program.uniforms.halfWorldSize, worldRadius);
    gl.uniform2f(
        this.program.uniforms.inverseHalfViewportSize, 2 * inverseArea[0], 2 * inverseArea[1]);
    gl.uniformMatrix4fv(this.program.uniforms.sphericalMvp, false, sphericalMvp);

    this.activate();
    let lastGeometry = undefined;
    let lastIndex = undefined;
    let lastTexture = undefined;
    let lastZ = 9999; // random large number
    const cxh = Math.fround(centerPixel[0]);
    const cyh = Math.fround(centerPixel[1]);
    gl.uniform4f(
        this.program.uniforms.cameraCenter, cxh, centerPixel[0] - cxh, cyh, centerPixel[1] - cyh);

    let drawStart = drawables[0];
    let drawStartIndex = 0;
    let pendingGeometryByteLength = drawStart.geometryByteLength;
    let pendingVertexCount = drawStart.vertexCount ?? 0;
    for (let i = 1; i < drawables.length; ++i) {
      const drawable = drawables[i];

      if (
          drawStart.elements === undefined
              && drawable.elements === undefined
              && drawStart.instanced === undefined
              && drawable.instanced === undefined
              && drawStart.geometry === drawable.geometry
              && drawStart.texture === drawable.texture
              && drawStart.z === drawable.z
              && drawStart.geometryOffset + pendingGeometryByteLength === drawable.geometryOffset
      ) {
        pendingGeometryByteLength += drawable.geometryByteLength;
        pendingVertexCount += drawable.vertexCount ?? 0;
        continue;
      }

      // TODO(april): should we merge instance calls? Maybe

      if (lastGeometry !== drawStart.geometry) {
        gl.bindBuffer(gl.ARRAY_BUFFER, drawStart.geometry);
        lastGeometry = drawStart.geometry;
      }
      const thisIndex = drawStart.elements?.index;
      if (lastIndex !== thisIndex && thisIndex) {
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, thisIndex);
        lastIndex = thisIndex;
      }
      if (lastTexture !== drawStart.texture && drawStart.texture) {
        gl.bindTexture(gl.TEXTURE_2D, drawStart.texture);
        lastTexture = drawStart.texture;
      }
      if (lastZ !== drawStart.z) {
        gl.uniform1f(this.program.uniforms.z, drawStart.z / 1000);
        lastZ = drawStart.z;
      }

      this.draw({
        elements: drawStart.elements,
        geometry: drawStart.geometry,
        geometryByteLength: pendingGeometryByteLength,
        geometryOffset: drawStart.geometryOffset,
        instanced: drawStart.instanced,
        program: drawStart.program,
        texture: drawStart.texture,
        vertexCount: pendingVertexCount,
        z: drawStart.z,
      });

      drawStart = drawable;
      drawStartIndex = i;
      pendingGeometryByteLength = drawStart.geometryByteLength;
      pendingVertexCount = drawStart.vertexCount ?? 0;
    }

    if (lastGeometry !== drawStart.geometry) {
      gl.bindBuffer(gl.ARRAY_BUFFER, drawStart.geometry);
      lastGeometry = drawStart.geometry;
    }
    const thisIndex = drawStart.elements?.index;
    if (lastIndex !== thisIndex && thisIndex) {
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, thisIndex);
      lastIndex = thisIndex;
    }
    if (lastTexture !== drawStart.texture && drawStart.texture) {
      gl.bindTexture(gl.TEXTURE_2D, drawStart.texture);
      lastTexture = drawStart.texture;
    }
    if (lastZ !== drawStart.z) {
      gl.uniform1f(this.program.uniforms.z, drawStart.z / 1000);
      lastZ = drawStart.z;
    }

    this.draw({
      elements: drawStart.elements,
      geometry: drawStart.geometry,
      geometryByteLength: pendingGeometryByteLength,
      geometryOffset: drawStart.geometryOffset,
      instanced: drawStart.instanced,
      program: drawStart.program,
      texture: drawStart.texture,
      vertexCount: pendingVertexCount,
      z: drawStart.z,
    });

    this.deactivate();
  }

  protected draw(drawable: Drawable): void {
    const gl = this.gl;
    this.bindAttributes(drawable.geometryOffset);

    if (drawable.elements) {
      gl.drawElements(
          this.geometryType, drawable.elements.count, gl.UNSIGNED_INT, drawable.elements.offset);
    } else if (drawable.instanced) {
      throw new Error('unimplemented');
    } else if (drawable.vertexCount !== undefined) {
      gl.drawArrays(this.geometryType, 0, drawable.vertexCount);
    } else {
      throw new Error("Expected either elements or raw vertices");
    }
  }

  protected activate(): void {}
  protected bindAttributes(offset: number): void {}
  protected deactivate(): void {}
}

export const COLOR_OPERATIONS = `
    vec4 uint32ToVec4(uint uint32) {
      return vec4(
          float((uint32 & 0xff000000u) >> 24u) / 255.,
          float((uint32 & 0x00ff0000u) >> 16u) / 255.,
          float((uint32 & 0x0000ff00u) >>  8u) / 255.,
          float((uint32 & 0x000000ffu) >>  0u) / 255.);
    }

    vec4 uint32FToVec4(float v) {
      uint uint32 = floatBitsToUint(v);
      return vec4(
          float((uint32 & 0xff000000u) >> 24u) / 255.,
          float((uint32 & 0x00ff0000u) >> 16u) / 255.,
          float((uint32 & 0x0000ff00u) >>  8u) / 255.,
          float((uint32 & 0x000000ffu) >>  0u) / 255.);
    }
`;

/**
 * Functions from luma.gl
 * https://github.com/visgl/luma.gl/blob/a999dc6d38169cb15120935cbeab55384140f1a5/modules/shadertools/src/modules-webgl1/math/fp64/fp64-arithmetic-glsl.ts
 *
 * luma.gl is provided under the MIT license
 *
 * Copyright (c) 2020 vis.gl contributors
 *
 * This software includes parts initially developed by Uber and open sourced under MIT license.
 * Copyright (c) 2015 Uber Technologies, Inc.
 *
 * This software includes parts of PhiloGL (https://github.com/philogb/philogl)
 * under MIT license. PhiloGL parts Copyright © 2013 Sencha Labs.
 *
 * This software includes adaptations of some postprocessing code from
 * THREE.js (https://github.com/mrdoob/three.js/) under MIT license.
 * THREE.js parts Copyright © 2010-2018 three.js authors.
 *
 * Additional attribution given in specific source files.
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */
export const FP64_OPERATIONS = `
// Divide float number to high and low floats to extend fraction bits
vec2 split(float a) {
  const float SPLIT = 4097.0;
  float t = a * SPLIT;
#if defined(LUMA_FP64_CODE_ELIMINATION_WORKAROUND)
  float a_hi = t * ONE - (t - a);
  float a_lo = a * ONE - a_hi;
#else
  float a_hi = t - (t - a);
  float a_lo = a - a_hi;
#endif
  return vec2(a_hi, a_lo);
}

// Divide float number again when high float uses too many fraction bits
vec2 split2(vec2 a) {
  vec2 b = split(a.x);
  b.y += a.y;
  return b;
}

// Special sum operation when a > b
vec2 quickTwoSum(float a, float b) {
#if defined(LUMA_FP64_CODE_ELIMINATION_WORKAROUND)
  float sum = (a + b) * ONE;
  float err = b - (sum - a) * ONE;
#else
  float sum = a + b;
  float err = b - (sum - a);
#endif
  return vec2(sum, err);
}

// General sum operation
vec2 twoSum(float a, float b) {
  float s = (a + b);
#if defined(LUMA_FP64_CODE_ELIMINATION_WORKAROUND)
  float v = (s * ONE - a) * ONE;
  float err = (a - (s - v) * ONE) * ONE * ONE * ONE + (b - v);
#else
  float v = s - a;
  float err = (a - (s - v)) + (b - v);
#endif
  return vec2(s, err);
}

vec2 twoSub(float a, float b) {
  float s = (a - b);
#if defined(LUMA_FP64_CODE_ELIMINATION_WORKAROUND)
  float v = (s * ONE - a) * ONE;
  float err = (a - (s - v) * ONE) * ONE * ONE * ONE - (b + v);
#else
  float v = s - a;
  float err = (a - (s - v)) - (b + v);
#endif
  return vec2(s, err);
}

vec2 twoProd(float a, float b) {
  float prod = a * b;
  vec2 a_fp64 = split(a);
  vec2 b_fp64 = split(b);
  float err = ((a_fp64.x * b_fp64.x - prod) + a_fp64.x * b_fp64.y +
    a_fp64.y * b_fp64.x) + a_fp64.y * b_fp64.y;
  return vec2(prod, err);
}

vec2 sum_fp64(vec2 a, vec2 b) {
  vec2 s, t;
  s = twoSum(a.x, b.x);
  t = twoSum(a.y, b.y);
  s.y += t.x;
  s = quickTwoSum(s.x, s.y);
  s.y += t.y;
  s = quickTwoSum(s.x, s.y);
  return s;
}

vec2 sub_fp64(vec2 a, vec2 b) {
  vec2 s, t;
  s = twoSub(a.x, b.x);
  t = twoSub(a.y, b.y);
  s.y += t.x;
  s = quickTwoSum(s.x, s.y);
  s.y += t.y;
  s = quickTwoSum(s.x, s.y);
  return s;
}

vec2 mul_fp64(vec2 a, vec2 b) {
  vec2 prod = twoProd(a.x, b.x);
  // y component is for the error
  prod.y += a.x * b.y;
#if defined(LUMA_FP64_HIGH_BITS_OVERFLOW_WORKAROUND)
  prod = split2(prod);
#endif
  prod = quickTwoSum(prod.x, prod.y);
  prod.y += a.y * b.x;
#if defined(LUMA_FP64_HIGH_BITS_OVERFLOW_WORKAROUND)
  prod = split2(prod);
#endif
  prod = quickTwoSum(prod.x, prod.y);
  return prod;
}

vec2 div_fp64(vec2 a, vec2 b) {
  float xn = 1.0 / b.x;
#if defined(LUMA_FP64_HIGH_BITS_OVERFLOW_WORKAROUND)
  vec2 yn = mul_fp64(a, vec2(xn, 0));
#else
  vec2 yn = a * xn;
#endif
  float diff = (sub_fp64(a, mul_fp64(b, yn))).x;
  vec2 prod = twoProd(xn, diff);
  return sum_fp64(yn, prod);
}

vec4 split(vec2 a) {
  return vec4(split(a.x), split(a.y));
}

vec4 div_fp64(vec4 a, vec4 b) {
  return vec4(div_fp64(a.xy, b.xy), div_fp64(a.zw, b.zw));
}

vec4 mul_fp64(vec4 a, vec4 b) {
  return vec4(mul_fp64(a.xy, b.xy), mul_fp64(a.zw, b.zw));
}

vec4 sub_fp64(vec4 a, vec4 b) {
  return vec4(sub_fp64(a.xy, b.xy), sub_fp64(a.zw, b.zw));
}

vec4 sum_fp64(vec4 a, vec4 b) {
  return vec4(sum_fp64(a.xy, b.xy), sum_fp64(a.zw, b.zw));
}
`;
