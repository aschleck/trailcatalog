import { checkExists } from 'external/dev_april_corgi~/js/common/asserts';
import { Disposable } from 'external/dev_april_corgi~/js/common/disposable';

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
    halfViewportSize: WebGLUniformLocation;
    halfWorldSize: WebGLUniformLocation;
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

  render(drawables: Drawable[], area: Vec2, centerPixels: Vec2[], worldRadius: number): void {
    const gl = this.gl;

    gl.useProgram(this.program.handle);
    gl.uniform2f(
        this.program.uniforms.halfViewportSize, area[0] / 2, area[1] / 2);
    gl.uniform1f(this.program.uniforms.halfWorldSize, worldRadius);

    this.activate();
    let lastGeometry = undefined;
    let lastIndex = undefined;
    let lastTexture = undefined;
    let lastZ = 9999; // random large number
    // TODO(april): support merging drawables?
    for (const centerPixel of centerPixels) {
      gl.uniform2fv(this.program.uniforms.cameraCenter, centerPixel);

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
    }
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

