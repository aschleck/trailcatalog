import { Disposable } from 'external/dev_april_corgi+/js/common/disposable';

import { Renderer } from './renderer';

export class TexturePool extends Disposable {

  private readonly all: WebGLTexture[];
  private readonly free: WebGLTexture[];

  constructor(private readonly renderer: Renderer) {
    super();
    this.all = [];
    this.free = [];

    this.registerDisposer(() => {
      for (const texture of this.all) {
        this.renderer.deleteTexture(texture);
      }
    });
  }

  acquire(): WebGLTexture {
    const free = this.free.pop();
    if (free) {
      return free;
    }
    const texture = this.renderer.createTexture();
    this.all.push(texture);
    return texture;
  }

  release(texture: WebGLTexture): void {
    this.free.push(texture);
  }
}
