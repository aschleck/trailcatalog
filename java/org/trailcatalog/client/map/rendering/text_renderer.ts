import { checkExists } from '../../common/asserts';
import { HashMap, HashSet } from '../../common/collections';
import { Vec2 } from '../../common/types';

import { RenderPlanner } from './render_planner';
import { Renderer } from './renderer';
import { TexturePool } from './texture_pool';

export enum Iconography {
  NONE = 0,
  PIN = 1,
}

const PIN_RADIUS_PX = 8;
const PIN_Y_UNCOVERED = 2;

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
      Math.ceil(
          Math.abs(metrics.actualBoundingBoxAscent) + Math.abs(metrics.actualBoundingBoxDescent)),
    ];

    const textWidth = textSize[0] + 2 * text.paddingX;
    const textHeight = textSize[1] + 2 * text.paddingY;

    let width, height;
    if (text.iconography === Iconography.PIN) {
      if (text.text) {
        width = Math.max(textWidth, 2 * PIN_RADIUS_PX + 2);
        height = textHeight + PIN_Y_UNCOVERED + PIN_RADIUS_PX;
      } else {
        width = 2 * PIN_RADIUS_PX + 2;
        height = 2 * PIN_RADIUS_PX;
      }
    } else {
      width = textWidth;
      height = textHeight;
    }

    const fullSize: Vec2 = [width + 2, height + 2];
    this.canvas.width = fullSize[0];
    this.canvas.height = fullSize[1];

    ctx.lineWidth = 2;
    ctx.strokeStyle = text.fillColor;

    if (text.iconography === Iconography.PIN) {
      renderPin(width / 2 + 1, height - PIN_RADIUS_PX + 1, PIN_RADIUS_PX, text.borderRadius, ctx);
    }

    if (text.text) {
      ctx.fillStyle = text.backgroundColor;
      ctx.beginPath();
      ctx.moveTo(textWidth, textHeight);
      ctx.arcTo(1, textHeight, 1, 1, text.borderRadius);
      ctx.arcTo(1, 1, textWidth - 1, 1, text.borderRadius);
      ctx.arcTo(textWidth - 1, 1, textWidth - 1, textHeight, text.borderRadius);
      ctx.arcTo(textWidth - 1, textHeight, 1, textHeight, text.borderRadius);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = text.fillColor;
      ctx.font = font;
      ctx.textBaseline = 'middle';
      ctx.fillText(text.text, 1 + text.paddingX, textHeight / 2 + 1);
    }
    
    const texture = this.pool.acquire();
    this.renderer.uploadTexture(this.canvas, texture);
    const offset: Vec2 = [0, fullSize[1] / 2];
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

function renderPin(
    x: number,
    y: number,
    radius: number,
    borderRadius: number,
    ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = '#3a3a3aff';

  ctx.beginPath();
  ctx.moveTo(x, y - radius);
  ctx.arcTo(x + radius, y - radius, x + radius, y, borderRadius);
  ctx.lineTo(x + radius, y);
  ctx.arcTo(x, y + radius, x - radius, y, borderRadius);
  ctx.lineTo(x - radius, y);
  ctx.arcTo(x - radius, y - radius, x, y - radius, borderRadius);
  ctx.lineTo(x, y - radius);
  ctx.fill();
  ctx.stroke();
}