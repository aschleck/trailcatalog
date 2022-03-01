import { checkExists } from './models/asserts';
import { HashMap } from './models/collections';
import { Vec2 } from './models/types';

import { RenderPlanner } from './render_planner';
import { Renderer } from './renderer';
import { TexturePool } from './texture_pool';

interface RenderableText {
  text: string;
  fontSize: number;
}

interface RenderedText {
  size: Vec2;
  texture: WebGLTexture;
}

export class TextRenderer {

  private readonly cache: HashMap<RenderableText, RenderedText>;
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private readonly pool: TexturePool;

  constructor(private readonly renderer: Renderer) {
    this.cache = new HashMap(k => `${k.fontSize}${k.text}`);
    this.canvas = document.createElement('canvas');
    this.context = checkExists(this.canvas.getContext('2d'));
    this.pool = new TexturePool(renderer);
  }

  plan(text: RenderableText, position: Vec2, planner: RenderPlanner): void {
    const cached = this.cache.get(text);
    if (cached) {
      planner.addBillboard(position, cached.size, cached.texture);
      return;
    }

    const ctx = this.context;
    ctx.font = `${text.fontSize}px sans-serif`;
    const metrics = ctx.measureText(text.text);
    const size: Vec2 = [
      Math.ceil(Math.abs(metrics.actualBoundingBoxLeft) + Math.abs(metrics.actualBoundingBoxRight)),
      Math.ceil(Math.abs(metrics.actualBoundingBoxAscent) + Math.abs(metrics.actualBoundingBoxDescent)),
    ];
    this.canvas.width = size[0];
    this.canvas.height = size[1];
    ctx.clearRect(0, 0, size[0], size[1]);
    ctx.font = `${text.fontSize}px sans-serif`;
    ctx.textBaseline = 'middle';
    ctx.fillText(text.text, 0, Math.floor(size[1] / 2));
    
    const texture = this.pool.acquire();
    this.renderer.uploadTexture(this.canvas, texture);
    this.cache.set(text, {
      size: [size[0], size[1]],
      texture,
    });
    planner.addBillboard(position, size, texture);
  }
}

