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
      out highp vec2 fragRay;
      out mediump vec2 fragRadius;
      flat out highp vec3 fragXAxis;
      flat out highp vec3 fragYAxis;
      flat out highp vec3 fragZAxis;

      const float PI = 3.141592653589793;

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

        // See program.ts#cameraScale.
        float scale = sphericalMvp[3].w;
        float theta = acos(1. / scale);
        float sinTheta = sin(theta);
        float cosTheta = cos(theta);
        vec4 top = sphericalMvp * vec4(cosTheta * zAxis + sinTheta * yAxis, 1);
        vec4 right = sphericalMvp * vec4(cosTheta * zAxis + sinTheta * xAxis, 1);

        vec2 spherical = position / vec2(right.x / right.w, top.y / top.w);
        fragPosition = spherical;
        // The silhouette subtends asin(1 / scale) from the eye, so its tangent 1 / sqrt(scale^2 - 1)
        // takes us from silhouette radii back to the slope of the view ray. The stars need the real
        // ray or else they rotate at the wrong rate and stretch toward the edges of the screen.
        fragRay = spherical / sqrt(scale * scale - 1.);
        fragXAxis = xAxis;
        fragYAxis = yAxis;
        fragZAxis = zAxis;
      }
    `;
  const fs = `#version 300 es

      in highp vec2 fragPosition;
      in highp vec2 fragRay;
      flat in highp vec3 fragXAxis;
      flat in highp vec3 fragYAxis;
      flat in highp vec3 fragZAxis;
      out mediump vec4 fragColor;

      // https://www.shadertoy.com/view/4djSRW
      highp float hash13(highp vec3 p3) {
        p3 = fract(p3 * 0.1031);
        p3 += dot(p3, p3.zyx + 31.32);
        return fract((p3.x + p3.y) * p3.z);
      }

      mediump vec3 starfield(highp vec3 dir, highp float radiansPerPixel) {
        // Stars live in a 3D grid of cells over the direction rather than a lng/lat grid, which
        // packs 1/cos(lat) more cells into the same patch of sky and piles stars up at the poles.
        const highp float DENSITY = 40.0;
        // 18000 of the 3D cells along the unit sphere keep their star, and 4500 stars over 4pi
        // steradians looks full without crowding the globe
        // => 4500 / 18000 = 25% of cells.
        const highp float THRESHOLD = 0.75;
        // Half-width of a star, in screen pixels.
        const highp float STAR_PX = 1.1;
        highp vec3 cell = floor(dir * DENSITY);
        highp float h = hash13(cell);
        if (h < THRESHOLD) {
          return vec3(0.0);
        }
        highp vec3 jitter = vec3(
            hash13(cell + vec3(1.7, 9.2, 4.1)),
            hash13(cell + vec3(8.3, 2.8, 6.5)),
            hash13(cell + vec3(3.9, 7.4, 0.6)));
        highp vec3 star = normalize(cell + jitter);
        // A star that lands in another cell would only be drawn over this cell's pixels and get cut
        // off, so we drop it.
        if (floor(star * DENSITY) != cell) {
          return vec3(0.0);
        }
        highp float dPx = length(dir - star) / (radiansPerPixel * STAR_PX);
        mediump float falloff = exp(-dPx * dPx);
        mediump float brightness = (h - THRESHOLD) / (1.0 - THRESHOLD);
        mediump vec3 tint =
            mix(vec3(1.0, 0.88, 0.70), vec3(0.75, 0.85, 1.0), hash13(cell + 5.0));
        return tint * falloff * brightness * 1.4;
      }

      void main() {
        const mediump float ATM = 1.04;
        const mediump float H = 0.008;
        const mediump vec3 SPACE_NEAR = vec3(0.020, 0.025, 0.045);
        const mediump vec3 SPACE_FAR = vec3(0.002, 0.003, 0.008);
        const mediump vec3 RAYLEIGH = vec3(0.30, 0.60, 1.00);

        // Derivatives are undefined once a pixel in the 2x2 quad has returned, and quads straddling
        // the silhouette would light up every star cell along it, so we take them before returning.
        highp vec3 skyDir = normalize(fragXAxis * fragRay.x + fragYAxis * fragRay.y - fragZAxis);
        highp float radiansPerPixel =
            max(0.5 * (length(dFdx(skyDir)) + length(dFdy(skyDir))), 1e-6);

        mediump float r = length(fragPosition);
        if (r < 1.0) {
          fragColor = vec4(0);
          return;
        }

        mediump float farMix = smoothstep(1.0, 1.6, r);
        mediump vec3 space = mix(SPACE_NEAR, SPACE_FAR, farMix);
        space += starfield(skyDir, radiansPerPixel);

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
