import { Renderer } from './renderer';

export class TexturePool {

  private readonly free: WebGLTexture[];

  constructor(private readonly renderer: Renderer) {
    this.free = [];
  }

  acquire(): WebGLTexture {
    return this.free.pop() ?? this.renderer.createTexture();
  }

  release(texture: WebGLTexture): void {
    this.free.push(texture);
  }
}

