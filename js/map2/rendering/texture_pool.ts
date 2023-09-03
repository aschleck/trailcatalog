import { Disposable } from 'js/common/disposable';

import { Renderer } from './renderer';

export class TexturePool extends Disposable {

  private readonly free: WebGLTexture[];

  constructor(private readonly renderer: Renderer) {
    super();
    this.free = [];
  }

  acquire(): WebGLTexture {
    return this.free.pop() ?? this.renderer.createTexture();
  }

  release(texture: WebGLTexture): void {
    this.free.push(texture);
  }
}

