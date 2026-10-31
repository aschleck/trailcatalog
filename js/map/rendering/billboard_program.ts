import { checkExists } from 'external/dev_april_corgi+/js/common/asserts';

import { RgbaU32, Vec2 } from '../common/types';

import {
  COLOR_OPERATIONS,
  Drawable,
  FP64_OPERATIONS,
  linkProgram,
  Program,
  ProgramData,
  SPHERE_OPERATIONS,
} from './program';

// A billboard is drawn as instances of a static lattice, so plan() writes only the per-instance
// attributes: 7 floats and 5 uint32s, all 4 bytes.
const INSTANCE_STRIDE = 4 * (7 + 5);

// Vertices for the whole billboard as one quad, which is exact once flattenFactor reaches 1
// because the mercator branch is affine in position.
const FLAT_VERTEX_COUNT = 6;
// Vertices for the 4 cells x 4 cells lattice the sphere needs to curve the billboard.
const GRID_VERTEX_COUNT = 4 * 4 * 6;

const TEXTURE_FRAGMENT_SHADER = `#version 300 es
    uniform sampler2D color;
    uniform mediump float flattenFactor;

    in mediump vec2 fragColorPosition;
    in mediump vec4 fragColorTint;
    in mediump float fragBehindHorizon;
    out mediump vec4 fragColor;

    void main() {
      if (flattenFactor < 1.0 && fragBehindHorizon < 0.0) {
        discard;
      }
      mediump vec4 tex = texture(color, fragColorPosition);
      fragColor = tex * vec4(fragColorTint.rgb, 1) * fragColorTint.a;
    }
`;

export class BillboardProgram extends Program<BillboardProgramData> {

  /** Bytes that {@link plan} will write into the supplied buffer. */
  static bytesNeeded(): number {
    return INSTANCE_STRIDE;
  }

  private readonly latticeBuffer: WebGLBuffer;
  private flattenFactor: number;

  constructor(gl: WebGL2RenderingContext, fs: string = TEXTURE_FRAGMENT_SHADER) {
    super(createBillboardProgram(gl, fs), gl, gl.TRIANGLES);

    // The flat quad comes first so draw() can take it as a prefix of the same buffer.
    const vertices = [...lattice(1), ...lattice(1 / 4)];
    this.latticeBuffer = checkExists(gl.createBuffer());
    gl.bindBuffer(gl.COPY_WRITE_BUFFER, this.latticeBuffer);
    gl.bufferData(gl.COPY_WRITE_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);
    gl.bindBuffer(gl.COPY_WRITE_BUFFER, null);
    this.registerDisposer(() => {
      gl.deleteBuffer(this.latticeBuffer);
    });

    this.flattenFactor = 1;
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
    pushInstance(
        center[0],
        center[1],
        offsetPx[0],
        offsetPx[1],
        size[0],
        size[1],
        angle,
        atlasIndex,
        atlasSize[0],
        atlasSize[1],
        tint,
        /* sizeIsPixels= */ size[0] >= 1 ? 1 : 0, // well this is sketchy
        buffer,
        offset);

    return {
      byteSize: INSTANCE_STRIDE,
      drawable: {
        elements: undefined,
        geometry: glBuffer,
        geometryByteLength: INSTANCE_STRIDE,
        geometryOffset: offset,
        instanced: {
          count: 1,
        },
        program: this,
        texture: glTexture,
        vertexCount: GRID_VERTEX_COUNT,
        z,
      },
    };
  }

  override render(
      drawables: Drawable[],
      centerPixel: Vec2,
      flattenFactor: number,
      inverseArea: Vec2,
      sphericalMvp: Float32Array,
      worldRadius: number,
  ): void {
    this.flattenFactor = flattenFactor;
    super.render(drawables, centerPixel, flattenFactor, inverseArea, sphericalMvp, worldRadius);
  }

  protected activate(): void {
    const gl = this.gl;

    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(this.program.uniforms.color, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.latticeBuffer);
    gl.enableVertexAttribArray(this.program.attributes.position);
    gl.vertexAttribPointer(
        this.program.attributes.position,
        2,
        gl.FLOAT,
        /* normalize= */ false,
        /* stride= */ 16,
        /* offset= */ 0);
    gl.enableVertexAttribArray(this.program.attributes.colorPosition);
    gl.vertexAttribPointer(
        this.program.attributes.colorPosition,
        2,
        gl.FLOAT,
        /* normalize= */ false,
        /* stride= */ 16,
        /* offset= */ 8);

    for (const attribute of [
      this.program.attributes.center,
      this.program.attributes.offsetPx,
      this.program.attributes.size,
      this.program.attributes.angle,
      this.program.attributes.atlasIndex,
      this.program.attributes.atlasSize,
      this.program.attributes.tint,
      this.program.attributes.sizeIsPixels,
    ]) {
      gl.enableVertexAttribArray(attribute);
      gl.vertexAttribDivisor(attribute, 1);
    }
  }

  protected override bindAttributes(offset: number): void {
    const gl = this.gl;

    gl.vertexAttribPointer(
        this.program.attributes.center,
        2,
        gl.FLOAT,
        /* normalize= */ false,
        /* stride= */ INSTANCE_STRIDE,
        /* offset= */ offset + 0);
    gl.vertexAttribPointer(
        this.program.attributes.offsetPx,
        2,
        gl.FLOAT,
        /* normalize= */ false,
        /* stride= */ INSTANCE_STRIDE,
        /* offset= */ offset + 8);
    gl.vertexAttribPointer(
        this.program.attributes.size,
        2,
        gl.FLOAT,
        /* normalize= */ false,
        /* stride= */ INSTANCE_STRIDE,
        /* offset= */ offset + 16);
    gl.vertexAttribPointer(
        this.program.attributes.angle,
        1,
        gl.FLOAT,
        /* normalize= */ false,
        /* stride= */ INSTANCE_STRIDE,
        /* offset= */ offset + 24);
    gl.vertexAttribIPointer(
        this.program.attributes.atlasIndex,
        1,
        gl.UNSIGNED_INT,
        /* stride= */ INSTANCE_STRIDE,
        /* offset= */ offset + 28);
    gl.vertexAttribIPointer(
        this.program.attributes.atlasSize,
        2,
        gl.UNSIGNED_INT,
        /* stride= */ INSTANCE_STRIDE,
        /* offset= */ offset + 32);
    gl.vertexAttribIPointer(
        this.program.attributes.tint,
        1,
        gl.UNSIGNED_INT,
        /* stride= */ INSTANCE_STRIDE,
        /* offset= */ offset + 40);
    gl.vertexAttribIPointer(
        this.program.attributes.sizeIsPixels,
        1,
        gl.UNSIGNED_INT,
        /* stride= */ INSTANCE_STRIDE,
        /* offset= */ offset + 44);
  }

  protected override draw(drawable: Drawable): void {
    if (!drawable.vertexCount || !drawable.instanced) {
      throw new Error('Expecting instances');
    }

    const gl = this.gl;
    this.bindAttributes(drawable.geometryOffset);

    const flat = this.flattenFactor >= 1;
    gl.drawArraysInstanced(
        gl.TRIANGLES,
        /* first= */ flat ? 0 : FLAT_VERTEX_COUNT,
        /* count= */ flat ? FLAT_VERTEX_COUNT : drawable.vertexCount,
        drawable.instanced.count);
  }

  protected deactivate(): void {
    const gl = this.gl;

    gl.disableVertexAttribArray(this.program.attributes.position);
    gl.disableVertexAttribArray(this.program.attributes.colorPosition);

    for (const attribute of [
      this.program.attributes.center,
      this.program.attributes.offsetPx,
      this.program.attributes.size,
      this.program.attributes.angle,
      this.program.attributes.atlasIndex,
      this.program.attributes.atlasSize,
      this.program.attributes.tint,
      this.program.attributes.sizeIsPixels,
    ]) {
      gl.vertexAttribDivisor(attribute, 0);
      gl.disableVertexAttribArray(attribute);
    }
  }
}

// Triangles covering the unit-centered quad as a grid of cells of the given step, laid out as
// position.xy then colorPosition.xy.
function lattice(step: number): number[] {
  const vertices = [];
  for (let y = -0.5; y < 0.5; y += step) {
    for (let x = -0.5; x < 0.5; x += step) {
      vertices.push(
          x, y, 0.5 + x, 0.5 - y,
          x + step, y, 0.5 + x + step, 0.5 - y,
          x, y + step, 0.5 + x, 0.5 - (y + step),

          x + step, y, 0.5 + x + step, 0.5 - y,
          x + step, y + step, 0.5 + x + step, 0.5 - (y + step),
          x, y + step, 0.5 + x, 0.5 - (y + step));
    }
  }
  return vertices;
}

// Keep in sync with bindAttributes.
function pushInstance(
    centerX: number,
    centerY: number,
    offsetPxX: number,
    offsetPxY: number,
    sizeX: number,
    sizeY: number,
    angle: number,
    atlasIndex: number,
    atlasSizeX: number,
    atlasSizeY: number,
    tint: RgbaU32,
    sizeIsPixels: number,
    buffer: ArrayBuffer,
    offset: number): void {
  const floats = new Float32Array(buffer, offset, INSTANCE_STRIDE / 4);
  // Colors may represent NaN floats, which get canonicalized, so they go in as uints.
  const uint32s = new Uint32Array(buffer, offset, INSTANCE_STRIDE / 4);

  floats[0] = centerX;
  floats[1] = centerY;
  floats[2] = offsetPxX;
  floats[3] = offsetPxY;
  floats[4] = sizeX;
  floats[5] = sizeY;
  floats[6] = angle;
  uint32s[7] = atlasIndex;
  uint32s[8] = atlasSizeX;
  uint32s[9] = atlasSizeY;
  uint32s[10] = tint;
  uint32s[11] = sizeIsPixels;
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

function createBillboardProgram(gl: WebGL2RenderingContext, fs: string): BillboardProgramData {
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

      // highp because overzoomed slope tiles address a texel across thousands of pixels
      out highp vec2 fragColorPosition;
      out mediump vec4 fragColorTint;
      out mediump float fragBehindHorizon;

      ${COLOR_OPERATIONS}
      ${FP64_OPERATIONS}
      ${SPHERE_OPERATIONS}

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
        vec4 mercator = vec4(p.x + p.y, p.z + p.w, -1, 1);

        // The spherical projection costs a tanh, an asin, and four more transcendentals, and mix
        // discards all of it once flattenFactor reaches 1. flattenFactor is a uniform, so the
        // branch is coherent across the draw.
        vec4 spherical = vec4(0.);
        highp float behindHorizon = 1.;
        if (flattenFactor < 1.) {
          vec4 sphericalOrigin = split(center) + (sizeIsPixels > 0u ? vec4(0) : rotated);
          float sinLat = tanh((sphericalOrigin.z + sphericalOrigin.w) * PI);
          float lat = asin(sinLat);
          float cosLat = cos(lat);
          float lng = (sphericalOrigin.x + sphericalOrigin.y) * PI;
          vec3 spherePos = vec3(cosLat * cos(lng), sinLat, cosLat * sin(lng));
          vec4 sphericalCenter = sphericalMvp * vec4(spherePos, 1.0);
          // See triangle_program.ts for why the back of the globe is culled by fragment.
          behindHorizon = horizonDistance(spherePos);
          vec4 sphericalSplit =
            sum_fp64(
              split(sphericalCenter.xy),
              sizeIsPixels > 0u
                ?
                  mul_fp64(
                      sum_fp64(rotated, split(offsetPx)), split(inverseHalfViewportSize))
                    * sphericalCenter.w
                : vec4(0));
          spherical =
            vec4(
              sphericalSplit.x + sphericalSplit.y,
              sphericalSplit.z + sphericalSplit.w,
              sphericalCenter.z,
              sphericalCenter.w);
        }

        gl_Position = mix(spherical, mercator, flattenFactor);
        gl_Position /= gl_Position.w;
        // Depth is the layer alone, the same as triangle_program.ts, or else a tile's flat cells sag
        // behind the polygons of lower layers near the limb and lose the depth test to them.
        gl_Position.z = 1. - 2. * z;

        fragBehindHorizon = behindHorizon;

        uvec2 atlasXy = uvec2(
            atlasIndex % atlasSize.x, atlasIndex / atlasSize.x);
        vec2 scale = 1. / vec2(atlasSize);
        vec2 translate = vec2(atlasXy) * scale;
        fragColorPosition = translate + scale * colorPosition;
        fragColorTint = uint32ToVec4(tint);
      }
    `;
  const programId = linkProgram(gl, vs, fs, 'billboard');

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
