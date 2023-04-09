import { checkExists } from 'js/common/asserts';

import { RgbaU32, Vec2, Vec4 } from '../common/types';

export interface Drawable {
  readonly buffer: WebGLBuffer;
  readonly instances?: number;
  readonly offset: number;
  readonly replace?: boolean;
  readonly program: Program<ProgramData>;
  readonly texture?: WebGLTexture;
  readonly z: number;

  // ???
  readonly fill?: RgbaU32;
  readonly stroke?: RgbaU32;
}

export interface ProgramData {
  readonly id: WebGLProgram;
  readonly instanceSize?: number;
  readonly vertexCount: number;

  readonly uniformBlock?: {
    index: GLuint;
    size: number;
  }

  readonly uniforms: {
    cameraCenter: WebGLUniformLocation;
    halfViewportSize: WebGLUniformLocation;
    halfWorldSize: WebGLUniformLocation;
  };
}

let nextProgramId = 0;

export abstract class Program<P extends ProgramData> {

  private readonly geometryType: number;
  readonly id: number;

  constructor(
      protected readonly program: P,
      protected readonly gl: WebGL2RenderingContext,
      geometryType?: number,
  ) {
    this.geometryType = geometryType ?? gl.TRIANGLE_STRIP;
    this.id = nextProgramId;
    nextProgramId += 1;
  }

  protected abstract activate(): void;
  protected abstract bind(offset: number): void;
  protected abstract deactivate(): void;

  render(area: Vec2, centerPixels: Vec4[], worldRadius: number, drawables: Drawable[]): void {
    const gl = this.gl;

    this.activate();

    gl.uniform2f(
        this.program.uniforms.halfViewportSize, area[0] / 2, area[1] / 2);
    gl.uniform1f(this.program.uniforms.halfWorldSize, worldRadius);

    const uniforms = this.program.uniformBlock;
    for (const drawable of drawables) {
      if (uniforms) {
        gl.bindBufferRange(
            gl.UNIFORM_BUFFER,
            checkExists(uniforms.index),
            drawable.buffer,
            drawable.offset,
            uniforms.size);
      }

      gl.bindBuffer(gl.ARRAY_BUFFER, drawable.buffer);
      this.bind(drawable.offset + (uniforms?.size ?? 0));

      if (drawable.texture) {
        gl.bindTexture(gl.TEXTURE_2D, drawable.texture);
      }

      for (const centerPixel of centerPixels) {
        gl.uniform4fv(this.program.uniforms.cameraCenter, centerPixel);
        this.draw(drawable);
      }
    }

    this.deactivate();
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    gl.bindBuffer(gl.UNIFORM_BUFFER, null);
  }

  protected createStaticBuffer(data: Float32Array): WebGLBuffer {
    const gl = this.gl;
    const buffer = checkExists(gl.createBuffer());
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    return buffer;
  }

  protected draw(drawable: Drawable): void {
    const gl = this.gl;
    if (drawable.instances) {
      gl.drawArraysInstanced(this.geometryType, 0, this.program.vertexCount, drawable.instances);
    } else {
      gl.drawArrays(this.geometryType, 0, this.program.vertexCount);
    }
  }
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

export const FP64_OPERATIONS = `
    vec4 divide2Into64(vec4 v, vec2 divisor) {
      return vec4(v.xy / divisor.x, v.zw / divisor.y);
    }

    vec4 perpendicular64(vec4 v) {
      return vec4(-v.zw, v.xy);
    }

    float inverseMagnitude64(vec4 v) {
      return inversesqrt(
          v.x * v.x + 2. * v.x * v.y + v.y * v.y +
          v.z * v.z + 2. * v.z * v.w + v.w * v.w);
    }

    float magnitude64(vec4 v) {
      return sqrt(
          v.x * v.x + 2. * v.x * v.y + v.y * v.y +
          v.z * v.z + 2. * v.z * v.w + v.w * v.w);
    }

    vec4 normalize64(vec4 v) {
      return v * inverseMagnitude64(v);
    }

    vec2 reduce64(vec4 v) {
      return vec2(v.x + v.y, v.z + v.w);
    }

    vec4 rotate64(vec4 v, float angle) {
      float c = cos(angle);
      float s = sin(angle);
      return vec4(v.xy * c - v.zw * s, v.xy * s + v.zw * c);
    }
`;
