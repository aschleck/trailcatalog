import { checkExists } from 'js/common/asserts';
import { HashMap, HashSet } from 'js/common/collections';
import { Disposable } from 'js/common/disposable';
import { RgbaU32, Vec2 } from 'js/map/common/types';
import { Drawable } from 'js/map/rendering/program';
import { Renderer } from 'js/map/rendering/renderer';
import { TexturePool } from 'js/map/rendering/texture_pool';

const DRAW_PADDING_PX = 1;
const NO_ATLAS = [1, 1] as const;
const PIN_BORDER_RADIUS_PX = 2;
const PIN_RADIUS_PX = 7;
const PIN_POINT_RADIUS_PX = [5, 5] as const;
const PIN_TEXT_PADDING_PX = [-1, 4] as const;

export interface RenderablePin {
  textSize: Vec2;
  fillColor: string;
  strokeColor: string;
}

interface RenderedTexture {
  generation: number;
  offset: Vec2;
  size: Vec2;
  textOffset: Vec2;
  texture: WebGLTexture;
}

export class PinRenderer extends Disposable {

  private readonly pinCache: HashMap<RenderablePin, RenderedTexture>;
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private readonly pool: TexturePool;
  private generation: number;

  constructor(private readonly renderer: Renderer) {
    super();
    this.pinCache = new HashMap(
        (k: RenderablePin) => `${k.textSize[0]},${k.textSize[1]}${k.fillColor}${k.strokeColor}`);
    this.registerDisposer(() => {
      for (const {texture} of this.pinCache.values()) {
        this.renderer.deleteTexture(texture);
      }
    });
    this.canvas = document.createElement('canvas');
    this.context = checkExists(this.canvas.getContext('2d'));
    this.pool = new TexturePool(renderer);
    this.registerDisposable(this.pool);
    this.generation = 0;
  }

  mark(): void {
    this.generation = Date.now();
  }

  sweep(): void {
    for (const [item, rendered] of this.pinCache) {
      if (rendered.generation < this.generation) {
        this.pinCache.delete(item);
        this.pool.release(rendered.texture);
      }
    }
  }

  measureUnlabeledPin(): Vec2 {
    return [
      2 * PIN_RADIUS_PX + 2 * DRAW_PADDING_PX,
      2 * PIN_RADIUS_PX + 2 * DRAW_PADDING_PX,
    ];
  }

  measureLabeledPin(textSize: Vec2): Vec2 {
    return [
      textSize[0] + 2 * textSize[1] + 2 * DRAW_PADDING_PX + 2 * PIN_TEXT_PADDING_PX[0],
      textSize[1] + PIN_POINT_RADIUS_PX[1] + 2 * DRAW_PADDING_PX + 2 * PIN_TEXT_PADDING_PX[1],
    ];
  }

  // Coordinate system: y=0 is the top

  planPin(
      pin: RenderablePin,
      position: Vec2,
      z: number,
      buffer: ArrayBuffer,
      offset: number,
      glBuffer: WebGLBuffer): {
    byteSize: number;
    drawable: Drawable;
    textOffset: Vec2;
  } {
    let cached = this.pinCache.get(pin);
    if (!cached) {
      if (pin.textSize[0] > 0 && pin.textSize[1] > 0) {
        cached = this.renderLabeledPin(pin);
      } else {
        cached = this.renderUnlabeledPin(pin);
      }
    }

    cached.generation = this.generation;
    const data = this.renderer.billboardProgram.plan(
        position,
        cached.offset,
        cached.size,
        /* angle= */ 0,
        0xFFFFFFFF as RgbaU32,
        z,
        /* atlasIndex= */ 0,
        NO_ATLAS,
        buffer,
        offset,
        glBuffer,
        cached.texture);
    return {
      ...data,
      textOffset: cached.textOffset,
    };
  }

  private renderUnlabeledPin(pin: RenderablePin): RenderedTexture {
    const fullSize = [
      2 * PIN_RADIUS_PX + 2 * DRAW_PADDING_PX,
      2 * PIN_RADIUS_PX + 2 * DRAW_PADDING_PX,
    ] as Vec2;
    this.canvas.width = fullSize[0];
    this.canvas.height = fullSize[1];

    const ctx = this.context;
    ctx.fillStyle = pin.fillColor;
    ctx.lineWidth = 2;
    ctx.strokeStyle = pin.strokeColor;

    drawUnlabeledPin(
        /* x= */ fullSize[0] / 2,
        /* y= */ fullSize[1] / 2,
        /* radius= */ PIN_RADIUS_PX,
        ctx);

    const texture = this.pool.acquire();
    this.renderer.uploadTexture(this.canvas, texture);
    const offset = [0, 0] as Vec2;
    const data = {
      generation: this.generation,
      offset,
      size: fullSize,
      textOffset: offset,
      texture,
    };
    this.pinCache.set(pin, data);
    return data;
  }

  private renderLabeledPin(pin: RenderablePin): RenderedTexture {
    const ctx = this.context;
    const textSize = pin.textSize;

    const fullSize = [
      textSize[0] + 2 * textSize[1] + 2 * DRAW_PADDING_PX + 2 * PIN_TEXT_PADDING_PX[0],
      textSize[1] + PIN_POINT_RADIUS_PX[1] + 2 * DRAW_PADDING_PX + 2 * PIN_TEXT_PADDING_PX[1],
    ] as Vec2;
    this.canvas.width = fullSize[0];
    this.canvas.height = fullSize[1];

    ctx.fillStyle = pin.fillColor;
    ctx.lineWidth = 2;
    ctx.strokeStyle = pin.strokeColor;

    drawLabeledPin(
        /* x= */ fullSize[0] / 2,
        /* y= */ (fullSize[1] - PIN_POINT_RADIUS_PX[1]) / 2,
        /* width= */ textSize[0] + 2 * PIN_TEXT_PADDING_PX[0],
        /* height= */ textSize[1] + 2 * PIN_TEXT_PADDING_PX[1],
        ctx);

    const texture = this.pool.acquire();
    this.renderer.uploadTexture(this.canvas, texture);
    const offset = [0, fullSize[1] / 2] as Vec2;
    const data = {
      generation: this.generation,
      offset,
      size: fullSize,
      textOffset: [
        textSize[1] / 2 + DRAW_PADDING_PX + PIN_TEXT_PADDING_PX[0],
        DRAW_PADDING_PX + PIN_TEXT_PADDING_PX[1] + textSize[1] / 2,
      ] as const,
      texture,
    };
    this.pinCache.set(pin, data);
    return data;
  }
}

function drawUnlabeledPin(
    x: number,
    y: number,
    radius: number,
    ctx: CanvasRenderingContext2D): void {
  ctx.beginPath();
  ctx.moveTo(x + PIN_BORDER_RADIUS_PX / 2, y - radius + PIN_BORDER_RADIUS_PX / 2);
  ctx.arcTo(x + radius, y, x, y + radius, PIN_BORDER_RADIUS_PX);
  ctx.arcTo(x, y + radius, x - radius, y, PIN_BORDER_RADIUS_PX);
  ctx.arcTo(x - radius, y, x, y - radius, PIN_BORDER_RADIUS_PX);
  ctx.arcTo(x, y - radius, x + radius, y, PIN_BORDER_RADIUS_PX);
  ctx.fill();
  ctx.stroke();
}

function drawLabeledPin(
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
