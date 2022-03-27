import { checkExists } from '../models/asserts';
import { HashMap, HashSet } from '../models/collections';
import { Vec2 } from '../models/types';

import { RenderPlanner } from './render_planner';
import { Renderer } from './renderer';
import { TexturePool } from './texture_pool';

export enum Iconography {
  NONE = 0,
  PIN = 1,
}

export interface RenderableText {
  text: string;
  backgroundColor: string,
  borderRadius: number,
  fillColor: string,
  fontSize: number;
  iconography: Iconography;
  paddingX: number;
  paddingY: number;
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

  measure(text: RenderableText): Vec2 {
    const font = `bold ${text.fontSize}px Roboto,sans-serif`;
    const ctx = this.context;
    ctx.font = font;
    const metrics = ctx.measureText(text.text);
    const textSize: Vec2 = [
      Math.ceil(Math.abs(metrics.actualBoundingBoxLeft) + Math.abs(metrics.actualBoundingBoxRight)),
      Math.ceil(Math.abs(metrics.actualBoundingBoxAscent) + Math.abs(metrics.actualBoundingBoxDescent)),
    ];
    let extraY;
    if (text.iconography === Iconography.PIN) {
      extraY = textSize[1];
    } else {
      extraY = 0;
    }
    const width = textSize[0] + 2 * text.paddingX;
    const height = textSize[1] + 2 * text.paddingY + extraY;
    return [width, height];
  }

  plan(text: RenderableText, position: Vec2, z: number, planner: RenderPlanner): void {
    this.textInUse.add(text);
    const cached = this.cache.get(text);
    if (cached) {
      planner.addBillboard(position, cached.offset, cached.size, cached.texture, z);
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
    let extraY;
    if (text.iconography === Iconography.PIN) {
      extraY = textSize[1];
    } else {
      extraY = 0;
    }
    const width = textSize[0] + 2 * text.paddingX;
    const height = textSize[1] + 2 * text.paddingY + extraY;
    const fullSize: Vec2 = [width, height];
    this.canvas.width = width;
    this.canvas.height = height;

    ctx.lineWidth = 1;
    ctx.fillStyle = text.backgroundColor;
    ctx.strokeStyle = text.fillColor;

    if (text.iconography === Iconography.PIN) {
      const radius = extraY * 0.75;
      const center = [width / 2, height - radius];
      ctx.beginPath();
      ctx.moveTo(center[0], center[1] + radius);
      ctx.arcTo(
          center[0] - radius,
          center[1],
          center[0],
          center[1] - radius,
          text.borderRadius);
      ctx.arcTo(
          center[0],
          center[1] - radius,
          center[0] + radius,
          center[1],
          text.borderRadius);
      ctx.arcTo(
          center[0] + radius,
          center[1],
          center[0],
          center[1] + radius,
          text.borderRadius);
      ctx.arcTo(
          center[0],
          center[1] + radius,
          center[0] - radius,
          center[1],
          text.borderRadius);
      ctx.fill();
      ctx.stroke();
    }

    ctx.beginPath();
    ctx.moveTo(width, height - extraY);
    ctx.arcTo(1, height - extraY, 1, 1, text.borderRadius);
    ctx.arcTo(1, 1, width - 1, 1, text.borderRadius);
    ctx.arcTo(width - 1, 1, width - 1, height - extraY, text.borderRadius);
    ctx.arcTo(width - 1, height - extraY, 1, height - extraY, text.borderRadius);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = text.fillColor;
    ctx.font = font;
    ctx.textBaseline = 'middle';
    ctx.fillText(text.text, text.paddingX, (height - extraY) / 2);
    
    const texture = this.pool.acquire();
    this.renderer.uploadTexture(this.canvas, texture);
    const offset: Vec2 = [0, height / 2];
    this.cache.set(text, {
      offset,
      size: fullSize,
      texture,
    });
    planner.addBillboard(position, offset, fullSize, texture, z);
  }
}

interface RenderedText {
  offset: Vec2;
  size: Vec2;
  texture: WebGLTexture;
}
