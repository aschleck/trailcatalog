import { checkExists } from 'external/dev_april_corgi~/js/common/asserts';
import { Disposable } from 'external/dev_april_corgi~/js/common/disposable';

import { Vec2 } from '../common/types';

import { BillboardProgram } from './billboard_program';
import { LineProgram } from './line_program';
import { LineCapProgram } from './line_cap_program';
import { SdfProgram } from './sdf_program';
import { TriangleProgram } from './triangle_program';

export class Renderer extends Disposable {

  readonly billboardProgram: BillboardProgram;
  readonly lineProgram: LineProgram;
  readonly lineCapProgram: LineCapProgram;
  readonly sdfProgram: SdfProgram;
  readonly triangleProgram: TriangleProgram;

  constructor(readonly gl: WebGL2RenderingContext) {
    super();
    this.billboardProgram = new BillboardProgram(this.gl);
    this.registerDisposable(this.billboardProgram);
    this.lineProgram = new LineProgram(this.gl);
    this.registerDisposable(this.lineProgram);
    // Ensure this is always after LineProgram
    this.lineCapProgram = new LineCapProgram(this.gl);
    this.registerDisposable(this.lineCapProgram);
    this.sdfProgram = new SdfProgram(this.gl);
    this.registerDisposable(this.sdfProgram);
    this.triangleProgram = new TriangleProgram(this.gl);
    this.registerDisposable(this.triangleProgram);

    gl.enable(gl.BLEND);
    gl.enable(gl.CULL_FACE);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);

    gl.clearColor(1, 1, 1, 1);
  }

  clear(): void {
    const gl = this.gl;
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  }

  createDataBuffer(byteSize: number, usage?: number): WebGLBuffer {
    const gl = this.gl;
    const buffer = checkExists(gl.createBuffer());
    gl.bindBuffer(gl.COPY_WRITE_BUFFER, buffer);
    gl.bufferData(gl.COPY_WRITE_BUFFER, byteSize, usage ?? gl.STREAM_DRAW);
    gl.bindBuffer(gl.COPY_WRITE_BUFFER, null);
    return buffer;
  }

  createIndexBuffer(byteSize: number): WebGLBuffer {
    // We need index variations on these because WebGL doesn't allow a buffer previously assigned
    // to something other than ELEMENT_ARRAY_BUFFER to be bound to ELEMENT_ARRAY_BUFFER later.
    const gl = this.gl;
    const buffer = checkExists(gl.createBuffer());
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, byteSize, gl.STREAM_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
    return buffer;
  }

  createTexture(): WebGLTexture {
    return checkExists(this.gl.createTexture());
  }

  deleteBuffer(buffer: WebGLBuffer): void {
    this.gl.deleteBuffer(buffer);
  }

  deleteTexture(texture: WebGLTexture): void {
    this.gl.deleteTexture(texture);
  }

  resize(area: Vec2): void {
    this.gl.viewport(0, 0, area[0], area[1]);
  }

  uploadData(source: ArrayBuffer, size: number, to: WebGLBuffer, usage?: number): void {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, to);
    gl.bufferData(gl.ARRAY_BUFFER, new Uint8Array(source, 0, size), usage ?? gl.STATIC_DRAW);
  }

  uploadIndices(source: ArrayBuffer, size: number, to: WebGLBuffer): void {
    if (size === 0) {
      return;
    }

    const gl = this.gl;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, to);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint8Array(source, 0, size), gl.STATIC_DRAW);
  }

  uploadAlphaTexture(source: Uint8Array, size: Vec2, target: WebGLTexture): void {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, target);
    gl.texImage2D(
        gl.TEXTURE_2D,
        /* level= */ 0,
        gl.ALPHA,
        size[0],
        size[1],
        /* border= */ 0,
        gl.ALPHA,
        gl.UNSIGNED_BYTE,
        source);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  uploadDataTexture(source: HTMLCanvasElement|ImageBitmap|ImageData, target: WebGLTexture): void {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, target);
    gl.texImage2D(
        gl.TEXTURE_2D,
        /* level= */ 0,
        gl.RGBA,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        source);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  uploadTexture(source: HTMLCanvasElement|ImageBitmap|ImageData, target: WebGLTexture): void {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, target);
    gl.texImage2D(
        gl.TEXTURE_2D,
        /* level= */ 0,
        gl.RGBA,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        source);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }
}

