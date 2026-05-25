import { checkExists } from 'external/dev_april_corgi+/js/common/asserts';

import { RgbaU32, Vec2 } from '../common/types';

import { COLOR_OPERATIONS, Drawable, FP64_OPERATIONS, Program, ProgramData } from './program';

export class SkyboxProgram extends Program<SkyboxProgramData> {

  private readonly boxData: Float32Array;

  constructor(gl: WebGL2RenderingContext) {
    super(createSkyboxProgram(gl), gl, gl.TRIANGLES);
    this.registerDisposer(() => {
      gl.deleteProgram(this.program.handle);
    });

    this.boxData = new Float32Array([
      -1, -1,
      1, -1,
      -1, 1,

      -1, 1,
      1, -1,
      1, 1,
    ]);
  }

  plan(
      buffer: ArrayBuffer,
      offset: number,
      glBuffer: WebGLBuffer,
      z: number,
  ): {byteSize: number; drawable: Drawable;} {
    const floats = new Float32Array(buffer, offset);
    floats.set(this.boxData);
    return {
      byteSize: 4 * this.boxData.length,
      drawable: {
        elements: undefined,
        geometry: glBuffer,
        geometryByteLength: 4 * this.boxData.length,
        geometryOffset: offset,
        instanced: undefined,
        program: this,
        texture: undefined,
        vertexCount: this.boxData.length / 2,
        z,
      },
    };
  }

  protected activate(): void {
    const gl = this.gl;
    gl.enableVertexAttribArray(this.program.attributes.position);
  }

  protected override bindAttributes(offset: number): void {
    const gl = this.gl;

    gl.vertexAttribPointer(
        this.program.attributes.position,
        2,
        gl.FLOAT,
        /* normalize= */ false,
        /* stride= */ 8,
        /* offset= */ offset + 0);
  }

  protected deactivate(): void {
    const gl = this.gl;
    gl.disableVertexAttribArray(this.program.attributes.position);
  }
}

interface SkyboxProgramData extends ProgramData {
  attributes: {
    position: number;
  };
  uniforms: {
    cameraCenter: WebGLUniformLocation;
    flattenFactor: WebGLUniformLocation;
    halfWorldSize: WebGLUniformLocation;
    inverseHalfViewportSize: WebGLUniformLocation;
    sphericalMvp: WebGLUniformLocation;
    z: WebGLUniformLocation;
  };
}

function createSkyboxProgram(gl: WebGL2RenderingContext): SkyboxProgramData {
  const programId = checkExists(gl.createProgram());

  const vs = `#version 300 es
      // Mercator coordinates range from -1 to 1 on both x and y
      // Pixels are in screen space (eg -320px to 320px for a 640px width)

      uniform highp vec4 cameraCenter; // Mercator
      uniform mediump float flattenFactor; // 0 to 1
      uniform highp float halfWorldSize; // pixels
      uniform highp vec2 inverseHalfViewportSize; // 1/pixels
      uniform highp mat4 sphericalMvp;
      uniform highp float z;

      in highp vec2 position; // -1 to 1

      // See https://github.com/visgl/luma.gl/issues/1764
      invariant gl_Position;

      out highp vec2 fragPosition;
      out mediump vec2 fragRadius;
      flat out highp vec3 fragXAxis;
      flat out highp vec3 fragYAxis;
      flat out highp vec3 fragZAxis;
      flat out highp float fragScale;

      const float PI = 3.141592653589793;
      // TODO(april): share FOV constant?
      const float FOV = PI / 4.;

      void main() {
        gl_Position = vec4(position, z + 1., 1.) + 0. * sphericalMvp * cameraCenter * halfWorldSize * flattenFactor + vec4(0.000001 * inverseHalfViewportSize, 0., 0.);

        float sinLat = tanh((cameraCenter.z + cameraCenter.w) * PI);
        float lat = asin(sinLat);
        float cosLat = cos(lat);
        float lng = (cameraCenter.x + cameraCenter.y) * PI;
        vec3 zAxis = vec3(
            cosLat * cos(lng), // x
            sinLat,            // y
            cosLat * sin(lng)  // z
        );
        lat += PI / 2.;
        cosLat = cos(lat);
        if (lat > PI) {
          lng += PI;
        }
        vec3 yAxis = vec3(
            cosLat * cos(lng), // x
            sin(lat),          // y
            cosLat * sin(lng)  // z
        );
        vec3 xAxis = cross(zAxis, yAxis);

        float viewportRadiusWorldUnitsAtLat =
          PI * cos(0.) / halfWorldSize / inverseHalfViewportSize.y;
        float distanceCameraToGlobeSurface = viewportRadiusWorldUnitsAtLat / tan(FOV / 2.);
        float scale = 1. + distanceCameraToGlobeSurface;
        float theta = acos(1. / scale);
        float sinTheta = sin(theta);
        float cosTheta = cos(theta);
        vec4 top = sphericalMvp * vec4(cosTheta * zAxis + sinTheta * yAxis, 1);
        vec4 right = sphericalMvp * vec4(cosTheta * zAxis + sinTheta * xAxis, 1);

        vec2 spherical = position / vec2(right.x / right.w, top.y / top.w);
        fragPosition = spherical;
        fragXAxis = xAxis;
        fragYAxis = yAxis;
        fragZAxis = zAxis;
        fragScale = scale;
      }
    `;
  const fs = `#version 300 es

      in highp vec2 fragPosition;
      flat in highp vec3 fragXAxis;
      flat in highp vec3 fragYAxis;
      flat in highp vec3 fragZAxis;
      flat in highp float fragScale;
      out mediump vec4 fragColor;

      const highp float PI = 3.141592653589793;

      highp float hash12(highp vec2 p) {
        highp vec3 p3 = fract(vec3(p.xyx) * 0.1031);
        p3 += dot(p3, p3.yzx + 33.33);
        return fract((p3.x + p3.y) * p3.z);
      }

      mediump vec3 starfield(highp vec3 dir) {
        const highp float DENSITY = 40.0;
        const highp float THRESHOLD = 0.972;
        // Half-width of a star, in screen pixels.
        const highp float STAR_PX = 1.1;
        // Convert direction to (lng, lat). Wrap lng so cells are continuous
        // across the lng = +/-PI seam.
        highp float lng = atan(dir.z, dir.x);
        highp float lat = asin(clamp(dir.y, -1.0, 1.0));
        highp vec2 scaled = vec2(lng, lat) * DENSITY;
        highp vec2 cell = floor(scaled);
        highp float ring = floor(2.0 * PI * DENSITY + 0.5);
        cell.x = mod(cell.x + ring, ring);
        highp float h = hash12(cell);
        if (h < THRESHOLD) {
          return vec3(0.0);
        }
        highp vec2 jitter = vec2(
            hash12(cell + vec2(1.7, 9.2)),
            hash12(cell + vec2(8.3, 2.8)));
        highp vec2 d = fract(scaled) - jitter;
        // Reproject d from angular (cell-fraction) units into screen pixels
        // using local derivatives. fwidth(scaled) is "cells per pixel" along
        // each screen axis, so dividing folds the projection's anisotropy in
        // and stars stay round and a constant size everywhere on screen.
        highp vec2 perPixel = max(fwidth(scaled), vec2(1e-6));
        highp vec2 dPx = d / (perPixel * STAR_PX);
        mediump float falloff = exp(-dot(dPx, dPx));
        mediump float brightness = (h - THRESHOLD) / (1.0 - THRESHOLD);
        mediump vec3 tint =
            mix(vec3(1.0, 0.88, 0.70), vec3(0.75, 0.85, 1.0), hash12(cell + 5.0));
        return tint * falloff * brightness * 1.4;
      }

      void main() {
        const mediump float ATM = 1.04;
        const mediump float H = 0.008;
        const mediump vec3 SPACE_NEAR = vec3(0.020, 0.025, 0.045);
        const mediump vec3 SPACE_FAR = vec3(0.002, 0.003, 0.008);
        const mediump vec3 RAYLEIGH = vec3(0.30, 0.60, 1.00);

        mediump float r = length(fragPosition);
        if (r < 1.0) {
          // The mbtile data has no coverage past +/-85 lat (the Mercator
          // limit), so the polar caps would otherwise render as the white
          // clear color. Map this pixel back to a sphere point and only
          // paint when it lands in one of the caps.
          highp float rSq = r * r;
          highp float scaleSq = fragScale * fragScale;
          highp float cosTheta =
              (rSq * fragScale + (scaleSq - 1.0) * sqrt(max(0.0, 1.0 - rSq)))
                  / (rSq + scaleSq - 1.0);
          highp float sinTheta = sqrt(max(0.0, 1.0 - cosTheta * cosTheta));
          highp vec2 perpDir = fragPosition / max(r, 1e-6);
          highp vec3 P =
              cosTheta * fragZAxis
                  + sinTheta * (perpDir.x * fragXAxis + perpDir.y * fragYAxis);
          // sin(MERCATOR_MAX_LAT) where MERCATOR_MAX_LAT = asin(tanh(PI))
          // is ~0.996272. Bias lower so the cap fill overlaps with the
          // tile coverage and we don't leave a thin precision gap showing
          // the white clear color at the seam.
          const mediump float CAP_SIN_LAT = 0.994;
          if (abs(P.y) > CAP_SIN_LAT) {
            const mediump vec3 OCEAN = vec3(0.322, 0.729, 0.922);
            const mediump vec3 ICE = vec3(1.0, 1.0, 1.0);
            fragColor = vec4(P.y > 0.0 ? OCEAN : ICE, 1.0);
          } else {
            fragColor = vec4(0);
          }
          return;
        }

        mediump float farMix = smoothstep(1.0, 1.6, r);
        mediump vec3 space = mix(SPACE_NEAR, SPACE_FAR, farMix);
        highp vec3 skyDir = normalize(
            fragXAxis * fragPosition.x + fragYAxis * fragPosition.y - fragZAxis);
        space += starfield(skyDir);

        if (r >= ATM) {
          fragColor = vec4(space, 1.0);
          return;
        }

        mediump float chord = sqrt(ATM * ATM - r * r);
        mediump float density = exp(-(r - 1.0) / H);
        mediump vec3 glow = RAYLEIGH * chord * density * 6.0;
        fragColor = vec4(glow + space, 1.0);
      }
  `;

  const vertexId = checkExists(gl.createShader(gl.VERTEX_SHADER));
  gl.shaderSource(vertexId, vs);
  gl.compileShader(vertexId);
  if (!gl.getShaderParameter(vertexId, gl.COMPILE_STATUS)) {
    throw new Error(`Unable to compile skybox vertex shader: ${gl.getShaderInfoLog(vertexId)}`);
  }
  gl.attachShader(programId, vertexId);

  const fragmentId = checkExists(gl.createShader(gl.FRAGMENT_SHADER));
  gl.shaderSource(fragmentId, fs);
  gl.compileShader(fragmentId);
  if (!gl.getShaderParameter(fragmentId, gl.COMPILE_STATUS)) {
    throw new Error(`Unable to compile skybox fragment shader: ${gl.getShaderInfoLog(fragmentId)}`);
  }
  gl.attachShader(programId, fragmentId);

  gl.linkProgram(programId);
  if (!gl.getProgramParameter(programId, gl.LINK_STATUS)) {
    throw new Error(`Unable to link skybox program: ${gl.getProgramInfoLog(programId)}`);
  }

  return {
    handle: programId,
    attributes: {
      position: gl.getAttribLocation(programId, 'position'),
    },
    uniforms: {
      cameraCenter: checkExists(gl.getUniformLocation(programId, 'cameraCenter')),
      flattenFactor: checkExists(gl.getUniformLocation(programId, 'flattenFactor')),
      halfWorldSize: checkExists(gl.getUniformLocation(programId, 'halfWorldSize')),
      inverseHalfViewportSize: checkExists(gl.getUniformLocation(programId, 'inverseHalfViewportSize')),
      sphericalMvp: checkExists(gl.getUniformLocation(programId, 'sphericalMvp')),
      z: checkExists(gl.getUniformLocation(programId, 'z')),
    },
  };
}
