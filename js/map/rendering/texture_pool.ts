import { Disposable } from 'external/dev_april_corgi+/js/common/disposable';

import { Renderer } from './renderer';

export class TexturePool extends Disposable {

  private readonly free: WebGLTexture[];

  constructor(private readonly renderer: Renderer) {
    super();
    this.free = [];

    this.registerDisposer(() => {
      for (const texture of this.free) {
        this.renderer.deleteTexture(texture);
      }
    });
  }

  acquire(): WebGLTexture {
    return this.free.pop() ?? this.renderer.createTexture();
  }

  release(texture: WebGLTexture): void {
    this.free.push(texture);
  }
}

