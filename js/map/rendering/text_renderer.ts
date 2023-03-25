import { checkExists } from 'js/common/asserts';
import { HashMap, HashSet } from 'js/common/collections';

import { Vec2 } from '../common/types';

import { RenderPlanner } from './render_planner';
import { Renderer } from './renderer';
import { TexturePool } from './texture_pool';

const DRAW_PADDING_PX = 1;
const DIAMOND_BORDER_RADIUS_PX = 2;
const DIAMOND_RADIUS_PX = 7;
const PIN_POINT_RADIUS_PX = [5, 5] as const;
const PIN_TEXT_PADDING_PX = [-1, 4] as const;

export interface RenderableDiamond {
  fillColor: string,
  strokeColor: string,
}

export interface RenderableText {
  text: string;
  fillColor: string,
  strokeColor: string,
  fontSize: number;
}

export class TextRenderer {

  private readonly diamondCache: HashMap<RenderableDiamond, RenderedTexture>;
  private readonly textCache: HashMap<RenderableText, RenderedTexture>;
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private readonly pool: TexturePool;
  private generation: number;

  constructor(private readonly renderer: Renderer) {
    this.diamondCache = new HashMap((k: RenderableDiamond) => `${k.fillColor}${k.strokeColor}`);
    this.textCache =
        new HashMap((k: RenderableText) => `${k.fontSize}${k.text}${k.fillColor}${k.strokeColor}`);
    this.canvas = document.createElement('canvas');
    this.context = checkExists(this.canvas.getContext('2d'));
    this.pool = new TexturePool(renderer);
    this.generation = 0;

    new FontFace(
        'Roboto',
        "url(https://fonts.gstatic.com/s/roboto/v30/KFOlCnqEu92Fr1MmEU9fBBc4AMP6lQ.woff2) "
            + "format('woff2')").load().then(() => {
              // Force regenerating all textures. This isn't clearly good because sizes will be
              // cached outside of this class and will likely mismatch.
              this.mark();
              this.sweep();
            });
  }

  mark(): void {
    this.generation = Date.now();
  }

  sweep(): void {
    for (const cache of [this.diamondCache, this.textCache]) {
      for (const [item, rendered] of cache) {
        if (rendered.generation < this.generation) {
          cache.delete(item);
          this.pool.release(rendered.texture);
        }
      }
    }
  }

  measureDiamond(): Vec2 {
    return [
      2 * DIAMOND_RADIUS_PX + 2 * DRAW_PADDING_PX,
      2 * DIAMOND_RADIUS_PX + 2 * DRAW_PADDING_PX,
    ];
  }

  measureText(text: RenderableText): Vec2 {
    const ctx = this.context;
    ctx.font = font(text);
    const metrics = ctx.measureText(text.text);
    const textSize: Vec2 = [
      Math.ceil(Math.abs(metrics.actualBoundingBoxLeft) + Math.abs(metrics.actualBoundingBoxRight)),
      Math.ceil(Math.abs(metrics.actualBoundingBoxAscent)),
    ];

    return [
      textSize[0] + 2 * textSize[1] + 2 * DRAW_PADDING_PX + 2 * PIN_TEXT_PADDING_PX[0],
      textSize[1] + PIN_POINT_RADIUS_PX[1] + 2 * DRAW_PADDING_PX + 2 * PIN_TEXT_PADDING_PX[1],
    ];
  }

  // Coordinate system: y=0 is the top

  planDiamond(diamond: RenderableDiamond, position: Vec2, z: number, planner: RenderPlanner): void {
    const cached = this.diamondCache.get(diamond);
    if (cached) {
      cached.generation = this.generation;
      planner.addBillboard(position, cached.offset, cached.size, cached.texture, z);
      return;
    }

    const fullSize = [
      2 * DIAMOND_RADIUS_PX + 2 * DRAW_PADDING_PX,
      2 * DIAMOND_RADIUS_PX + 2 * DRAW_PADDING_PX,
    ] as Vec2;
    this.canvas.width = fullSize[0];
    this.canvas.height = fullSize[1];

    const ctx = this.context;
    ctx.fillStyle = diamond.fillColor;
    ctx.lineWidth = 2;
    ctx.strokeStyle = diamond.strokeColor;

    renderDiamond(
        /* x= */ fullSize[0] / 2,
        /* y= */ fullSize[1] / 2,
        /* radius= */ DIAMOND_RADIUS_PX,
        ctx);

    const texture = this.pool.acquire();
    this.renderer.uploadTexture(this.canvas, texture);
    const offset = [0, 0] as Vec2;
    this.diamondCache.set(diamond, {
      generation: this.generation,
      offset,
      size: fullSize,
      texture,
    });
    planner.addBillboard(position, offset, fullSize, texture, z);
  }

  planText(text: RenderableText, position: Vec2, z: number, planner: RenderPlanner): void {
    const cached = this.textCache.get(text);
    if (cached) {
      cached.generation = this.generation;
      planner.addBillboard(position, cached.offset, cached.size, cached.texture, z);
      return;
    }

    const ctx = this.context;
    ctx.font = font(text);
    const metrics = ctx.measureText(text.text);
    const textSize: Vec2 = [
      Math.ceil(Math.abs(metrics.actualBoundingBoxLeft) + Math.abs(metrics.actualBoundingBoxRight)),
      Math.ceil(Math.abs(metrics.actualBoundingBoxAscent)),
    ];

    const fullSize = [
      textSize[0] + 2 * textSize[1] + 2 * DRAW_PADDING_PX + 2 * PIN_TEXT_PADDING_PX[0],
      textSize[1] + PIN_POINT_RADIUS_PX[1] + 2 * DRAW_PADDING_PX + 2 * PIN_TEXT_PADDING_PX[1],
    ] as Vec2;
    this.canvas.width = fullSize[0];
    this.canvas.height = fullSize[1];

    ctx.fillStyle = text.fillColor;
    ctx.font = font(text);
    ctx.lineWidth = 2;
    ctx.strokeStyle = text.strokeColor;

    renderPin(
        /* x= */ fullSize[0] / 2,
        /* y= */ (fullSize[1] - PIN_POINT_RADIUS_PX[1]) / 2,
        /* width= */ textSize[0] + 2 * PIN_TEXT_PADDING_PX[0],
        /* height= */ textSize[1] + 2 * PIN_TEXT_PADDING_PX[1],
        ctx);

    ctx.fillStyle = text.strokeColor;
    ctx.fillText(
        text.text,
        textSize[1] + DRAW_PADDING_PX + PIN_TEXT_PADDING_PX[0],
        DRAW_PADDING_PX + PIN_TEXT_PADDING_PX[1] + textSize[1]);

    const texture = this.pool.acquire();
    this.renderer.uploadTexture(this.canvas, texture);
    const offset = [0, fullSize[1] / 2] as Vec2;
    this.textCache.set(text, {
      generation: this.generation,
      offset,
      size: fullSize,
      texture,
    });
    planner.addBillboard(position, offset, fullSize, texture, z);
  }
}

interface RenderedTexture {
  generation: number;
  offset: Vec2;
  size: Vec2;
  texture: WebGLTexture;
}

function font(text: RenderableText): string {
  return `500 ${text.fontSize}px Roboto,sans-serif`;
}

function renderDiamond(
    x: number,
    y: number,
    radius: number,
    ctx: CanvasRenderingContext2D): void {
  ctx.beginPath();
  ctx.moveTo(x + DIAMOND_BORDER_RADIUS_PX / 2, y - radius + DIAMOND_BORDER_RADIUS_PX / 2);
  ctx.arcTo(x + radius, y, x, y + radius, DIAMOND_BORDER_RADIUS_PX);
  ctx.arcTo(x, y + radius, x - radius, y, DIAMOND_BORDER_RADIUS_PX);
  ctx.arcTo(x - radius, y, x, y - radius, DIAMOND_BORDER_RADIUS_PX);
  ctx.arcTo(x, y - radius, x + radius, y, DIAMOND_BORDER_RADIUS_PX);
  ctx.fill();
  ctx.stroke();
}

function renderPin(
    x: number,
    y: number,
    width: number,
    height: number,
    ctx: CanvasRenderingContext2D): void {
  const radius = height / 2;
  ctx.arc(x - width / 2, y, radius, 0.5 * Math.PI, 1.5 * Math.PI);
  ctx.arc(x + width / 2, y, radius, 1.5 * Math.PI, 2.5 * Math.PI);
  ctx.lineTo(x + PIN_POINT_RADIUS_PX[0], y + radius);
  ctx.lineTo(x, y + radius + PIN_POINT_RADIUS_PX[1]);
  ctx.lineTo(x - PIN_POINT_RADIUS_PX[0], y + radius);
  ctx.lineTo(x - width / 2, y + radius);
  ctx.fill();
  ctx.stroke();
}
