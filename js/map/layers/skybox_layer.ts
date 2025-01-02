import { Layer } from '../layer';
import { Planner } from '../rendering/planner';
import { Drawable } from '../rendering/program';
import { Renderer } from '../rendering/renderer';

export class SkyboxLayer extends Layer {

  private readonly buffer: WebGLBuffer;
  private readonly drawable: Drawable;

  constructor(
      private readonly z: number,
      private readonly renderer: Renderer,
  ) {
    super([]);
    this.buffer = this.renderer.createDataBuffer(0);
    this.registerDisposer(() => { this.renderer.deleteBuffer(this.buffer); });

    const buffer = new ArrayBuffer(48 * 2 * 4);
    const drawables = [];
    this.drawable =
        this.renderer.skyboxProgram.plan(
            buffer,
            /* offset= */ 0,
            this.buffer,
            this.z).drawable;
    this.renderer.uploadData(buffer, buffer.byteLength, this.buffer);
  }

  override render(planner: Planner): void {
    planner.add([this.drawable]);
  }
}

