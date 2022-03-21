import { checkExists } from '../models/asserts';
import { HashMap, HashSet } from '../models/collections';
import { Vec2 } from '../models/types';

import { RenderPlanner } from './render_planner';
import { Renderer } from './renderer';
import { TexturePool } from './texture_pool';

interface RenderableText {
  text: string;
  backgroundColor: string,
  borderRadius: number,
  fillColor: string,
  fontSize: number;
  paddingX: number;
  paddingY: number;
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
  private readonly textInUse: HashSet<RenderableText>;

  constructor(private readonly renderer: Renderer) {
    this.cache = new HashMap(k => `${k.fontSize}${k.text}`);
    this.canvas = document.createElement('canvas');
    this.context = checkExists(this.canvas.getContext('2d'));
    this.pool = new TexturePool(renderer);
    this.textInUse = new HashSet(k => `${k.fontSize}${k.text}`);

    new FontFace(
        'Roboto',
        "url(https://fonts.gstatic.com/s/roboto/v29/KFOlCnqEu92Fr1MmWUlfBBc4AMP6lQ.woff2) "
            + "format('woff2')").load().then(() => {
              // Force regenerating all textures
              this.mark();
              this.sweep();
            });
  }

  mark(): void {
    this.textInUse.clear();
  }

  sweep(): void {
    for (const [text, rendered] of this.cache) {
      if (!this.textInUse.has(text)) {
        this.cache.delete(text);
        this.pool.release(rendered.texture);
      }
    }
  }

  plan(text: RenderableText, position: Vec2, z: number, planner: RenderPlanner): void {
    this.textInUse.add(text);
    const cached = this.cache.get(text);
    if (cached) {
      planner.addBillboard(position, cached.size, cached.texture, z);
      return;
    }

    const font = `bold ${text.fontSize}px Roboto,sans-serif`;
    const ctx = this.context;
    ctx.font = font;
    const metrics = ctx.measureText(text.text);
    const textSize: Vec2 = [
      Math.ceil(Math.abs(metrics.actualBoundingBoxLeft) + Math.abs(metrics.actualBoundingBoxRight)),
      Math.ceil(Math.abs(metrics.actualBoundingBoxAscent) + Math.abs(metrics.actualBoundingBoxDescent)),
    ];
    const width = textSize[0] + 2 * text.paddingX;
    const height = textSize[1] + 2 * text.paddingY;
    const fullSize: Vec2 = [width, height];
    this.canvas.width = width;
    this.canvas.height = height;

    ctx.fillStyle = text.backgroundColor;
    ctx.fillRect(0, 0, width, height);

    ctx.lineWidth = 2;
    ctx.strokeStyle = text.fillColor;
    ctx.beginPath();
    ctx.moveTo(width, height);
    ctx.arcTo(0, height, 0, 0, text.borderRadius);
    ctx.arcTo(0, 0, width, 0, text.borderRadius);
    ctx.arcTo(width, 0, width, height, text.borderRadius);
    ctx.arcTo(width, height, 0, height, text.borderRadius);
    ctx.stroke();

    ctx.fillStyle = text.fillColor;
    ctx.font = font;
    ctx.textBaseline = 'middle';
    ctx.fillText(text.text, text.paddingX, Math.floor(height / 2));
    
    const texture = this.pool.acquire();
    this.renderer.uploadTexture(this.canvas, texture);
    this.cache.set(text, {
      size: fullSize,
      texture,
    });
    planner.addBillboard(position, fullSize, texture, z);
  }
}

