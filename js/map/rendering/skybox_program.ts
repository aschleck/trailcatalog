import { checkExists } from 'external/dev_april_corgi~/js/common/asserts';

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

      out mediump vec2 fragPosition;
      out mediump vec2 fragRadius;

      const float PI = 3.141592653589793;
      // TODO(april): share FOV constant?
      const float FOV = PI / 4.;

      void main() {
        gl_Position = vec4(position, z + 1., 1.) + 0. * sphericalMvp * cameraCenter * halfWorldSize;

        vec2 mercator = vec2(0);

        float viewportRadiusWorldUnitsAtLat =
          PI * cos(0.) / halfWorldSize / inverseHalfViewportSize.y;
        float distanceCameraToGlobeSurface = viewportRadiusWorldUnitsAtLat / tan(FOV / 2.);
        float scale = 1. + distanceCameraToGlobeSurface;

        float angleOriginGlobeEdge = asin(1. / scale);
        float angleCenterGlobeEdge = PI / 2. - angleOriginGlobeEdge;

        float sinLat = tanh(0. * PI);
        float lat = asin(sinLat);
        float cosLat = cos(lat);
        float lng = (cameraCenter.x + cameraCenter.y) * PI + angleCenterGlobeEdge;
        vec4 p = sphericalMvp * vec4(
            cosLat * cos(lng), // x
            sinLat,            // y
            cosLat * sin(lng), // z
            1.0                // w
        );
        vec2 trueRadius = p.xy / p.w;

        // Try to figure out the screen coordinate of position in units of trueRadius
        vec2 spherical = position / trueRadius;
        fragPosition = mix(spherical, mercator, flattenFactor);
      }
    `;
  const fs = `#version 300 es

      in mediump vec2 fragPosition;
      out mediump vec4 fragColor;

      void main() {
        fragColor = length(fragPosition) > 1. ? vec4(fragPosition, 0., 1.) : vec4(0);
      }
  `;

  const vertexId = checkExists(gl.createShader(gl.VERTEX_SHADER));
  gl.shaderSource(vertexId, vs);
  gl.compileShader(vertexId);
  if (!gl.getShaderParameter(vertexId, gl.COMPILE_STATUS)) {
    throw new Error(`Unable to compile sdf vertex shader: ${gl.getShaderInfoLog(vertexId)}`);
  }
  gl.attachShader(programId, vertexId);

  const fragmentId = checkExists(gl.createShader(gl.FRAGMENT_SHADER));
  gl.shaderSource(fragmentId, fs);
  gl.compileShader(fragmentId);
  if (!gl.getShaderParameter(fragmentId, gl.COMPILE_STATUS)) {
    throw new Error(`Unable to compile sdf fragment shader: ${gl.getShaderInfoLog(fragmentId)}`);
  }
  gl.attachShader(programId, fragmentId);

  gl.linkProgram(programId);
  if (!gl.getProgramParameter(programId, gl.LINK_STATUS)) {
    throw new Error(`Unable to link sdf program: ${gl.getProgramInfoLog(programId)}`);
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
