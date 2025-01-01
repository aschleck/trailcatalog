import { checkExists } from 'external/dev_april_corgi~/js/common/asserts';

import { RgbaU32, Vec2 } from '../common/types';

import { COLOR_OPERATIONS, Drawable, FP64_OPERATIONS, Program, ProgramData } from './program';

export class BillboardProgram extends Program<BillboardProgramData> {

  private readonly billboardData: Float32Array;

  constructor(gl: WebGL2RenderingContext) {
    super(createBillboardProgram(gl), gl, gl.TRIANGLES);
    this.registerDisposer(() => {
      gl.deleteProgram(this.program.handle);
    });

    const vertices = [];
    const step = 1 / 4;
    for (let y = -0.5; y < 0.5; y += step) {
      for (let x = -0.5; x < 0.5; x += step) {
        vertices.push(...[
          x, y, 0.5 + x, 0.5 - y,
          x + step, y, 0.5 + x + step, 0.5 - y,
          x, y + step, 0.5 + x, 0.5 - (y + step),

          x + step, y, 0.5 + x + step, 0.5 - y,
          x + step, y + step, 0.5 + x + step, 0.5 - (y + step),
          x, y + step, 0.5 + x, 0.5 - (y + step),
        ]);
      }
    }
    this.billboardData = new Float32Array(vertices);
  }

  plan(
      center: Vec2,
      offsetPx: Vec2,
      size: Vec2,
      angle: number,
      tint: RgbaU32,
      z: number,
      atlasIndex: number,
      atlasSize: Vec2,
      buffer: ArrayBuffer,
      offset: number,
      glBuffer: WebGLBuffer,
      glTexture: WebGLTexture,
  ): {byteSize: number; drawable: Drawable;} {
    const floats = new Float32Array(buffer, offset);
    const uint32s = new Uint32Array(buffer, offset);

    const x = center[0];
    const y = center[1];
    const w = size[0];
    const h = size[1];

    let count = 0;
    for (let i = 0; i < this.billboardData.length; i += 4) {
      floats.set([
        /* position= */ this.billboardData[i + 0], this.billboardData[i + 1],
        /* colorPosition= */ this.billboardData[i + 2], this.billboardData[i + 3],
        /* center= */ x, y,
        /* offsetPx= */ offsetPx[0], offsetPx[1],
        /* size= */ w, h,
        /* angle= */ angle,
      ], count);
      count += 11;

      uint32s.set([
        /* atlasIndex= */ atlasIndex,
        /* atlasSize= */ atlasSize[0], atlasSize[1],
        /* tint= */ tint,
        /* sizeIsPixels= */ size[0] >= 1 ? 1 : 0, // well this is sketchy
      ], count);
      count += 5;
    }

    return {
      byteSize: count * 4,
      drawable: {
        elements: undefined,
        geometry: glBuffer,
        geometryByteLength: 4 * count,
        geometryOffset: offset,
        instanced: undefined,
        program: this,
        texture: glTexture,
        vertexCount: this.billboardData.length / 4,
        z,
      },
    };
  }

  protected activate(): void {
    const gl = this.gl;

    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(this.program.uniforms.color, 0);

    gl.enableVertexAttribArray(this.program.attributes.position);
    gl.enableVertexAttribArray(this.program.attributes.colorPosition);
    gl.enableVertexAttribArray(this.program.attributes.center);
    gl.enableVertexAttribArray(this.program.attributes.offsetPx);
    gl.enableVertexAttribArray(this.program.attributes.size);
    gl.enableVertexAttribArray(this.program.attributes.angle);
    gl.enableVertexAttribArray(this.program.attributes.atlasIndex);
    gl.enableVertexAttribArray(this.program.attributes.atlasSize);
    gl.enableVertexAttribArray(this.program.attributes.tint);
    gl.enableVertexAttribArray(this.program.attributes.sizeIsPixels);
  }

  protected override bindAttributes(offset: number): void {
    const gl = this.gl;

    gl.vertexAttribPointer(
        this.program.attributes.position,
        2,
        gl.FLOAT,
        /* normalize= */ false,
        /* stride= */ 64,
        /* offset= */ offset + 0);
    gl.vertexAttribPointer(
        this.program.attributes.colorPosition,
        2,
        gl.FLOAT,
        /* normalize= */ false,
        /* stride= */ 64,
        /* offset= */ offset + 8);
    gl.vertexAttribPointer(
        this.program.attributes.center,
        2,
        gl.FLOAT,
        /* normalize= */ false,
        /* stride= */ 64,
        /* offset= */ offset + 16);
    gl.vertexAttribPointer(
        this.program.attributes.offsetPx,
        2,
        gl.FLOAT,
        /* normalize= */ false,
        /* stride= */ 64,
        /* offset= */ offset + 24);
    gl.vertexAttribPointer(
        this.program.attributes.size,
        2,
        gl.FLOAT,
        /* normalize= */ false,
        /* stride= */ 64,
        /* offset= */ offset + 32);
    gl.vertexAttribPointer(
        this.program.attributes.angle,
        1,
        gl.FLOAT,
        /* normalize= */ false,
        /* stride= */ 64,
        /* offset= */ offset + 40);
    gl.vertexAttribIPointer(
        this.program.attributes.atlasIndex,
        1,
        gl.UNSIGNED_INT,
        /* stride= */ 64,
        /* offset= */ offset + 44);
    gl.vertexAttribIPointer(
        this.program.attributes.atlasSize,
        2,
        gl.UNSIGNED_INT,
        /* stride= */ 64,
        /* offset= */ offset + 48);
    gl.vertexAttribIPointer(
        this.program.attributes.tint,
        1,
        gl.UNSIGNED_INT,
        /* stride= */ 64,
        /* offset= */ offset + 56);
    gl.vertexAttribIPointer(
        this.program.attributes.sizeIsPixels,
        1,
        gl.UNSIGNED_INT,
        /* stride= */ 64,
        /* offset= */ offset + 60);
  }

  protected deactivate(): void {
    const gl = this.gl;

    gl.disableVertexAttribArray(this.program.attributes.position);
    gl.disableVertexAttribArray(this.program.attributes.colorPosition);
    gl.disableVertexAttribArray(this.program.attributes.center);
    gl.disableVertexAttribArray(this.program.attributes.offsetPx);
    gl.disableVertexAttribArray(this.program.attributes.size);
    gl.disableVertexAttribArray(this.program.attributes.angle);
    gl.disableVertexAttribArray(this.program.attributes.atlasIndex);
    gl.disableVertexAttribArray(this.program.attributes.atlasSize);
    gl.disableVertexAttribArray(this.program.attributes.tint);
    gl.disableVertexAttribArray(this.program.attributes.sizeIsPixels);
  }
}

interface BillboardProgramData extends ProgramData {
  attributes: {
    position: number;
    colorPosition: number;
    center: number;
    offsetPx: number;
    size: number;
    angle: number;
    atlasIndex: number;
    atlasSize: number;
    tint: number;
    sizeIsPixels: number;
  };

  uniforms: {
    cameraCenter: WebGLUniformLocation;
    color: WebGLUniformLocation;
    flattenFactor: WebGLUniformLocation;
    halfWorldSize: WebGLUniformLocation;
    inverseHalfViewportSize: WebGLUniformLocation;
    sphericalMvp: WebGLUniformLocation;
    z: WebGLUniformLocation;
  };
}

function createBillboardProgram(gl: WebGL2RenderingContext): BillboardProgramData {
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

      in highp vec2 position;
      in mediump vec2 colorPosition;
      in highp vec2 center; // Mercator
      in highp vec2 offsetPx; // pixels
      in highp vec2 size; // Mercator or pixels
      in highp float angle; // Radians
      in uint atlasIndex;
      in uvec2 atlasSize;
      in uint tint;
      in uint sizeIsPixels;

      // See https://github.com/visgl/luma.gl/issues/1764
      invariant gl_Position;

      out mediump vec2 fragColorPosition;
      out mediump vec4 fragColorTint;

      ${COLOR_OPERATIONS}
      ${FP64_OPERATIONS}

      const float PI = 3.141592653589793;

      void main() {
        vec4 relativeCenter = sub_fp64(split(center), cameraCenter);
        if (relativeCenter.x + relativeCenter.y > 1.) {
          relativeCenter.x -= 2.;
        } else if (relativeCenter.x + relativeCenter.y < -1.) {
          relativeCenter.x += 2.;
        }
        vec4 extents = mul_fp64(split(position), split(size));
        vec2 c = split(cos(angle));
        vec2 s = split(sin(angle));
        vec4 rotated =
            vec4(
                sub_fp64(mul_fp64(extents.xy, c), mul_fp64(extents.zw, s)),
                sum_fp64(mul_fp64(extents.xy, s), mul_fp64(extents.zw, c)));
        vec4 worldCoord =
            sizeIsPixels > 0u
                ?
                    sum_fp64(
                        mul_fp64(relativeCenter, vec4(split(halfWorldSize), split(halfWorldSize))),
                        rotated)
                :
                    mul_fp64(
                        sum_fp64(relativeCenter, rotated),
                        vec4(split(halfWorldSize), split(halfWorldSize)));
        vec4 screenCoord = sum_fp64(worldCoord, split(offsetPx));
        vec4 p = mul_fp64(screenCoord, split(inverseHalfViewportSize));
        vec4 mercator = vec4(p.x + p.y, p.z + p.w, z, 1);

        // Calculate the spherical projection
        vec4 sphericalOrigin = split(center) + (sizeIsPixels > 0u ? vec4(0) : rotated);
        float sinLat = tanh((sphericalOrigin.z + sphericalOrigin.w) * PI);
        float lat = asin(sinLat);
        float cosLat = cos(lat);
        float lng = (sphericalOrigin.x + sphericalOrigin.y) * PI;
        vec4 sphericalCenter = sphericalMvp * vec4(
            cosLat * cos(lng), // x
            sinLat,            // y
            cosLat * sin(lng), // z
            1.0                // w
        );
        vec4 sphericalSplit =
          sum_fp64(
            split(sphericalCenter.xy),
            sizeIsPixels > 0u
              ?
                mul_fp64(
                    sum_fp64(rotated, split(offsetPx)), split(inverseHalfViewportSize))
                  * sphericalCenter.w
              : vec4(0));
        vec4 spherical =
          vec4(
            sphericalSplit.x + sphericalSplit.y,
            sphericalSplit.z + sphericalSplit.w,
            sphericalCenter.z,
            sphericalCenter.w);
        spherical.z *= -1.;

        gl_Position = mix(spherical, mercator, flattenFactor);
        gl_Position.z = z * sign(gl_Position.z) * gl_Position.w;

        uvec2 atlasXy = uvec2(
            atlasIndex % atlasSize.x, atlasIndex / atlasSize.x);
        vec2 scale = 1. / vec2(atlasSize);
        vec2 translate = vec2(atlasXy) * scale;
        fragColorPosition = translate + scale * colorPosition;
        fragColorTint = uint32ToVec4(tint);
      }
    `;
  const fs = `#version 300 es
      uniform sampler2D color;

      in mediump vec2 fragColorPosition;
      in mediump vec4 fragColorTint;
      out mediump vec4 fragColor;

      void main() {
        mediump vec4 tex = texture(color, fragColorPosition);
        fragColor = tex * vec4(fragColorTint.rgb, 1) * fragColorTint.a;
      }
  `;

  const vertexId = checkExists(gl.createShader(gl.VERTEX_SHADER));
  gl.shaderSource(vertexId, vs);
  gl.compileShader(vertexId);
  if (!gl.getShaderParameter(vertexId, gl.COMPILE_STATUS)) {
    throw new Error(`Unable to compile billboard vertex shader: ${gl.getShaderInfoLog(vertexId)}`);
  }
  gl.attachShader(programId, vertexId);

  const fragmentId = checkExists(gl.createShader(gl.FRAGMENT_SHADER));
  gl.shaderSource(fragmentId, fs);
  gl.compileShader(fragmentId);
  if (!gl.getShaderParameter(fragmentId, gl.COMPILE_STATUS)) {
    throw new Error(`Unable to compile billboard fragment shader: ${gl.getShaderInfoLog(fragmentId)}`);
  }
  gl.attachShader(programId, fragmentId);

  gl.linkProgram(programId);
  if (!gl.getProgramParameter(programId, gl.LINK_STATUS)) {
    throw new Error(`Unable to link billboard program: ${gl.getProgramInfoLog(programId)}`);
  }

  return {
    handle: programId,
    attributes: {
      position: gl.getAttribLocation(programId, 'position'),
      colorPosition: gl.getAttribLocation(programId, 'colorPosition'),
      center: gl.getAttribLocation(programId, 'center'),
      offsetPx: gl.getAttribLocation(programId, 'offsetPx'),
      size: gl.getAttribLocation(programId, 'size'),
      angle: gl.getAttribLocation(programId, 'angle'),
      atlasIndex: gl.getAttribLocation(programId, 'atlasIndex'),
      atlasSize: gl.getAttribLocation(programId, 'atlasSize'),
      tint: gl.getAttribLocation(programId, 'tint'),
      sizeIsPixels: gl.getAttribLocation(programId, 'sizeIsPixels'),
    },
    uniforms: {
      cameraCenter: checkExists(gl.getUniformLocation(programId, 'cameraCenter')),
      color: checkExists(gl.getUniformLocation(programId, 'color')),
      flattenFactor: checkExists(gl.getUniformLocation(programId, 'flattenFactor')),
      halfWorldSize: checkExists(gl.getUniformLocation(programId, 'halfWorldSize')),
      inverseHalfViewportSize: checkExists(gl.getUniformLocation(programId, 'inverseHalfViewportSize')),
      sphericalMvp: checkExists(gl.getUniformLocation(programId, 'sphericalMvp')),
      z: checkExists(gl.getUniformLocation(programId, 'z')),
    },
  };
}
