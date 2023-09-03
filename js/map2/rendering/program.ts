import { checkExists } from 'js/common/asserts';
import { Disposable } from 'js/common/disposable';

import { RgbaU32, Vec2 } from '../common/types';

import { Renderer } from './renderer';

export interface Drawable {
  readonly buffer: WebGLBuffer;
  readonly offset: number;
  readonly program: Program<ProgramData>;
  readonly texture?: WebGLTexture;
  readonly vertexCount: number;
  readonly z: number;
}

export interface ProgramData {
  readonly handle: WebGLProgram;

  readonly uniforms: {
    cameraCenter: WebGLUniformLocation;
    halfViewportSize: WebGLUniformLocation;
    halfWorldSize: WebGLUniformLocation;
  };
}

let nextProgramId = 0;

export abstract class Program<P extends ProgramData> extends Disposable {

  readonly id: number;

  constructor(
      protected readonly program: P,
      protected readonly renderer: Renderer,
      private readonly geometryType: number,
  ) {
    super();
    this.id = nextProgramId;
    nextProgramId += 1;
  }

  render(drawables: Drawable[], area: Vec2, centerPixels: Vec2[], worldRadius: number): void {
    const gl = this.renderer.gl;

    gl.useProgram(this.program.handle);
    gl.uniform2f(
        this.program.uniforms.halfViewportSize, area[0] / 2, area[1] / 2);
    gl.uniform1f(this.program.uniforms.halfWorldSize, worldRadius);

    // TODO(april): yikes!
    for (const drawable of drawables) {
      for (const centerPixel of centerPixels) {
        gl.uniform2fv(this.program.uniforms.cameraCenter, centerPixel);
        this.draw(drawable);
      }
    }
  }

  private draw(drawable: Drawable): void {
    const gl = this.renderer.gl;

    gl.bindBuffer(gl.ARRAY_BUFFER, drawable.buffer);
    if (drawable.texture) {
      gl.bindTexture(gl.TEXTURE_2D, drawable.texture);
    }

    this.activate();
    this.bindAttributes(drawable.offset);
    gl.drawArrays(this.geometryType, 0, drawable.vertexCount);
    this.deactivate();
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

