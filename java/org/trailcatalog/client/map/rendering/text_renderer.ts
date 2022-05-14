import { checkExists } from '../../common/asserts';
import { HashMap, HashSet } from '../../common/collections';
import { Vec2 } from '../../common/types';

import { RenderPlanner } from './render_planner';
import { Renderer } from './renderer';
import { TexturePool } from './texture_pool';

export enum Iconography {
  NONE = 0,
  DIAMOND = 1,
}

const DIAMOND_BORDER_RADIUS_PX = 2;
export const DIAMOND_RADIUS_PX = 8;
const DIAMOND_Y_PADDING_PX = 4;

export interface RenderableText {
  text: string;
  backgroundColor: string,
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
    const keyFn =
        (k: RenderableText) => `${k.fontSize}${k.text}${k.backgroundColor}${k.fillColor}`
    this.cache = new HashMap(keyFn);
    this.canvas = document.createElement('canvas');
    this.context = checkExists(this.canvas.getContext('2d'));
    this.pool = new TexturePool(renderer);
    this.textInUse = new HashSet(keyFn);

    new FontFace(
        'Roboto',
        "url(https://fonts.gstatic.com/s/roboto/v30/KFOmCnqEu92Fr1Mu4mxKKTU1Kg.woff2) "
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
    const font = `${text.fontSize}px Roboto,sans-serif`;
    const ctx = this.context;
    ctx.font = font;
    const metrics = ctx.measureText(text.text);
    const textSize: Vec2 = [
      Math.ceil(Math.abs(metrics.actualBoundingBoxLeft) + Math.abs(metrics.actualBoundingBoxRight)),
      Math.ceil(Math.abs(metrics.actualBoundingBoxAscent)),
    ];

    const textWidth = textSize[0] + 2 * text.paddingX;
    const textHeight = textSize[1] + 2 * text.paddingY;

    let width, height;
    if (text.iconography === Iconography.DIAMOND) {
      if (text.text) {
        width = Math.max(textWidth, 2 * DIAMOND_RADIUS_PX + DIAMOND_BORDER_RADIUS_PX);
        height = textHeight + 2 * DIAMOND_RADIUS_PX + DIAMOND_Y_PADDING_PX;
      } else {
        width = 2 * DIAMOND_RADIUS_PX + 20;
        height = 2 * DIAMOND_RADIUS_PX + 20;
      }
    } else {
      width = textWidth;
      height = textHeight;
    }

    return [width, height];
  }

  plan(text: RenderableText, position: Vec2, z: number, planner: RenderPlanner): void {
    // Coordinate system: y=0 is the top

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
      // TODO(april): no letters below baseline pass through this method, so we drop it. Sketchy.
      Math.ceil(Math.abs(metrics.actualBoundingBoxAscent)),
    ];

    const textWidth = textSize[0] + 2 * text.paddingX;
    const textHeight = textSize[1] + 2 * text.paddingY;

    let width, height;
    if (text.iconography === Iconography.DIAMOND) {
      if (text.text) {
        width = Math.max(textWidth, 2 * DIAMOND_RADIUS_PX + DIAMOND_BORDER_RADIUS_PX);
        height = textHeight + 2 * DIAMOND_RADIUS_PX + DIAMOND_Y_PADDING_PX;
      } else {
        width = 2 * DIAMOND_RADIUS_PX + 20;
        height = 2 * DIAMOND_RADIUS_PX + 20;
      }
    } else {
      width = textWidth;
      height = textHeight;
    }

    const fullSize: Vec2 = [width, height];
    this.canvas.width = fullSize[0];
    this.canvas.height = fullSize[1];

    ctx.fillStyle = text.backgroundColor;
    ctx.lineWidth = 2;
    ctx.strokeStyle = text.fillColor;

    let textYOffset;
    if (text.iconography === Iconography.DIAMOND) {
      renderDiamond(
          /* x= */ width / 2,
          /* y= */ DIAMOND_RADIUS_PX + DIAMOND_BORDER_RADIUS_PX / 2,
          /* radius= */ DIAMOND_RADIUS_PX,
          ctx);
      textYOffset = 2 * DIAMOND_RADIUS_PX + DIAMOND_Y_PADDING_PX;
    } else {
      textYOffset = 1;
    }

    if (text.text) {
      const overlapX = text.paddingY / 3;
      ctx.beginPath();
      ctx.moveTo(1 + text.paddingX + overlapX, textYOffset)
      ctx.lineTo(textWidth - text.paddingX - overlapX, textYOffset);
      ctx.quadraticCurveTo(
          textWidth + text.paddingX - 1,
          textYOffset + textHeight / 2,
          textWidth - text.paddingX - overlapX,
          textYOffset + textHeight - 1);
      ctx.lineTo(1 + text.paddingX + overlapX, textYOffset + textHeight - 1);
      ctx.quadraticCurveTo(
          -text.paddingX,
          textYOffset + textHeight / 2,
          1 + text.paddingX + overlapX,
          textYOffset);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = text.fillColor;
      ctx.font = font;
      ctx.textBaseline = 'middle';
      ctx.fillText(text.text, text.paddingX, textYOffset + textHeight / 2);
    }
    
    const texture = this.pool.acquire();
    this.renderer.uploadTexture(this.canvas, texture);
    const offset: Vec2 = [0, -fullSize[1] / 2 + textYOffset / 2];
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

function renderDiamond(
    x: number,
    y: number,
    radius: number,
    ctx: CanvasRenderingContext2D): void {
  ctx.beginPath();
  ctx.moveTo(x, y - radius);
  ctx.arcTo(x + radius, y, x + radius, y + radius, DIAMOND_BORDER_RADIUS_PX);
  ctx.lineTo(x + radius, y);
  ctx.arcTo(x, y + radius, x - radius, y, DIAMOND_BORDER_RADIUS_PX);
  ctx.lineTo(x - radius, y);
  ctx.arcTo(x, y - radius, x + radius, y - radius, DIAMOND_BORDER_RADIUS_PX);
  ctx.fill();
  ctx.stroke();
}
