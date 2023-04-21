import { checkExists } from 'js/common/asserts';

import { Vec2 } from '../common/types';

export class Renderer {

  constructor(readonly gl: WebGL2RenderingContext) {
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);

    gl.clearColor(0.95, 0.95, 0.95, 1);
    gl.stencilOp(gl.KEEP, gl.KEEP, gl.REPLACE);
  }

  createDataBuffer(byteSize: number): WebGLBuffer {
    const gl = this.gl;
    const buffer = checkExists(gl.createBuffer());
    gl.bindBuffer(gl.COPY_WRITE_BUFFER, buffer);
    gl.bufferData(gl.COPY_WRITE_BUFFER, byteSize, gl.STREAM_DRAW);
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

  deleteTexture(texture: WebGLTexture): void {
    this.gl.deleteTexture(texture);
  }

  render(): void {
    const gl = this.gl;

    gl.clear(gl.COLOR_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
  }

  resize(area: Vec2): void {
    this.gl.viewport(0, 0, area[0], area[1]);
  }

  uploadData(source: ArrayBuffer, size: number, to: WebGLBuffer): void {
    const gl = this.gl;
    gl.bindBuffer(gl.COPY_WRITE_BUFFER, to);
    gl.bufferSubData(gl.COPY_WRITE_BUFFER, 0, new Uint8Array(source), 0, size);
    gl.bindBuffer(gl.COPY_WRITE_BUFFER, null);
  }

  uploadIndices(source: ArrayBuffer, size: number, to: WebGLBuffer): void {
    if (size === 0) {
      return;
    }

    const gl = this.gl;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, to);
    gl.bufferSubData(gl.ELEMENT_ARRAY_BUFFER, 0, new Uint8Array(source), 0, size);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
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
    gl.bindTexture(gl.TEXTURE_2D, null);
  }
}

