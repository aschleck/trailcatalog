import { checkExists } from 'js/common/asserts';

import { Vec2 } from '../common/types';

import { FP64_OPERATIONS, Program, ProgramData } from './program';

export class BillboardProgram extends Program<BillboardProgramData> {

  private readonly billboardBuffer: WebGLBuffer;

  constructor(gl: WebGL2RenderingContext) {
    super(createBillboardProgram(gl), gl);
    this.billboardBuffer =
        this.createStaticBuffer(
                new Float32Array([
                  -0.5, -0.5, 0, 1,
                  -0.5, 0.5, 0, 0,
                  0.5, -0.5, 1, 1,
                  0.5, 0.5, 1, 0,
                ]));
  }

  plan(
      center: Vec2,
      offsetPx: Vec2,
      size: Vec2,
      angle: number,
      atlasIndex: number,
      atlasSize: Vec2,
      buffer: ArrayBuffer,
      offset: number): number {
    const floats = new Float32Array(buffer, offset);
    const uint32s = new Uint32Array(buffer, offset);

    const x = center[0];
    const xF = Math.fround(x);
    const xR = x - xF;
    const y = center[1];
    const yF = Math.fround(y);
    const yR = y - yF;

    const w = size[0];
    const wF = Math.fround(w);
    const wR = w - wF;
    const h = size[1];
    const hF = Math.fround(h);
    const hR = h - hF;

    // It's wasteful to use 32-bit ints here (could use 8s) but we have 256 bytes anyway.
    uint32s.set([
      // We merge index and size because otherwise std140 gives index a uvec4.
      /* atlasIndexAndSize= */ atlasIndex, atlasSize[0], atlasSize[1], 0,
      /* sizeIsPixels= */ size[0] >= 1 ? 1 : 0, // well this is sketchy
      /* pad out the boolean to clean stale data */ 0, 0, 0,
    ], 0);

    floats.set([
      /* center= */ xF, xR, yF, yR,
      /* offsetPx= */ offsetPx[0], offsetPx[1],
      /* std140 padding= */ 0, 0,
      /* size= */ wF, wR, hF, hR,
      /* angle= */ angle,
    ], 2 * 4);

    return 2 * 4 * 4 + 4 * 4 + 4 * 4 + 4 * 4 + 4;
  }

  protected activate(): void {
    const gl = this.gl;

    gl.useProgram(this.program.id);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.billboardBuffer);

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

    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(this.program.uniforms.color, 0);
  }

  protected bind(offset: number): void {}

  protected deactivate(): void {
    const gl = this.gl;

    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.disableVertexAttribArray(this.program.attributes.position);
    gl.disableVertexAttribArray(this.program.attributes.colorPosition);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    gl.useProgram(null);
  }
}

interface BillboardProgramData extends ProgramData {
  id: WebGLProgram;

  attributes: {
    position: number;
    colorPosition: number;
  };

  uniforms: {
    cameraCenter: WebGLUniformLocation;
    color: WebGLUniformLocation;
    halfViewportSize: WebGLUniformLocation;
    halfWorldSize: WebGLUniformLocation;
  };
}

function createBillboardProgram(gl: WebGL2RenderingContext): BillboardProgramData {
  const programId = checkExists(gl.createProgram());

  const vs = `#version 300 es
      // Mercator coordinates range from -1 to 1 on both x and y
      // Pixels are in screen space (eg -320px to 320px for a 640px width)

      uniform highp vec4 cameraCenter; // Mercator
      uniform highp vec2 halfViewportSize; // pixels
      uniform highp float halfWorldSize; // pixels

      layout(std140) uniform PerBillboardBlock {
        mediump uvec4 atlasIndexAndSize;
        bool sizeIsPixels;
        highp vec4 center; // Mercator
        highp vec2 offsetPx; // pixels
        highp vec4 size; // Mercator or pixels
        highp float angle; // Radians
      };

      in highp vec2 position;
      in mediump vec2 colorPosition;

      out mediump vec2 fragColorPosition;

      ${FP64_OPERATIONS}

      void main() {
        vec4 relativeCenter = center - cameraCenter;
        vec4 extents = vec4(position.x * size.xy, position.y * size.zw);
        vec4 rotated = rotate64(extents, angle);
        vec4 worldCoord =
            sizeIsPixels
                ? relativeCenter * halfWorldSize + rotated
                : (relativeCenter + rotated) * halfWorldSize;
        vec2 screenCoord = reduce64(worldCoord) + offsetPx;
        gl_Position = vec4(screenCoord / halfViewportSize, 0, 1);

        uvec2 atlasXy = uvec2(
            atlasIndexAndSize.x % atlasIndexAndSize.y, atlasIndexAndSize.x / atlasIndexAndSize.y);
        vec2 scale = 1. / vec4(atlasIndexAndSize).yz;
        vec2 translate = vec2(atlasXy) * scale;
        fragColorPosition = translate + scale * colorPosition;
      }
    `;
  const fs = `#version 300 es
      uniform sampler2D color;

      in mediump vec2 fragColorPosition;
      out mediump vec4 fragColor;

      void main() {
        fragColor = texture(color, fragColorPosition);
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
    id: programId,
    attributes: {
      position: gl.getAttribLocation(programId, 'position'),
      colorPosition: gl.getAttribLocation(programId, 'colorPosition'),
    },
    uniforms: {
      cameraCenter: checkExists(gl.getUniformLocation(programId, 'cameraCenter')),
      color: checkExists(gl.getUniformLocation(programId, 'color')),
      halfViewportSize: checkExists(gl.getUniformLocation(programId, 'halfViewportSize')),
      halfWorldSize: checkExists(gl.getUniformLocation(programId, 'halfWorldSize')),
    },
    uniformBlock: {
      index: gl.getUniformBlockIndex(programId, 'PerBillboardBlock'),
      size: 256,
    },
    vertexCount: 4,
  };
}
