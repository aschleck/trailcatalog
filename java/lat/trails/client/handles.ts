import { RgbaU32, Vec2 } from 'js/map/common/types';
import { BillboardProgram } from 'js/map/rendering/billboard_program';
import { Drawable } from 'js/map/rendering/program';
import { Renderer } from 'js/map/rendering/renderer';

export const HANDLE_COLOR = 0x2F6FEBFF as RgbaU32;
export const HANDLE_SIZE_PX = 9;
// Small enough to read as a place to add a vertex rather than a vertex
export const INSERT_HANDLE_SIZE_PX = 7;

// Two cells: hollow, then filled for the vertex that was placed or picked last.
const ATLAS_SIZE = [2, 1] as Vec2;
// Drawn at twice the size it shows at, so that it stays crisp on a high density screen
const TEXTURE_CELL_PX = 18;
const TEXTURE_BORDER_PX = 3;

export interface Handle {
  at: Vec2;
  filled: boolean;
  sizePx: number;
}

/** Uploads the square handle atlas, which the caller deletes along with its layer. */
export function createHandleTexture(renderer: Renderer): WebGLTexture {
  const texture = renderer.createTexture();
  renderer.uploadTexture(drawAtlas(), texture);
  return texture;
}

export function handleBytesNeeded(count: number): number {
  return count * BillboardProgram.bytesNeeded();
}

/**
 * Writes square handles one after another, which BillboardProgram draws as one instanced call
 * because they share a buffer, a texture, and a z.
 */
export function planHandles(
    handles: Handle[],
    z: number,
    buffer: ArrayBuffer,
    offset: number,
    glBuffer: WebGLBuffer,
    texture: WebGLTexture,
    renderer: Renderer): {byteSize: number; drawables: Drawable[]} {
  const drawables = [];
  let byteSize = 0;
  for (const handle of handles) {
    const planned =
        renderer.billboardProgram.plan(
            handle.at,
            /* offsetPx= */ [0, 0],
            [handle.sizePx, handle.sizePx],
            /* angle= */ 0,
            /* tint= */ 0xFFFFFFFF as RgbaU32,
            z,
            /* atlasIndex= */ handle.filled ? 1 : 0,
            ATLAS_SIZE,
            buffer,
            offset + byteSize,
            glBuffer,
            texture);
    drawables.push(planned.drawable);
    byteSize += planned.byteSize;
  }
  return {byteSize, drawables};
}

function drawAtlas(): HTMLCanvasElement {
  const cell = TEXTURE_CELL_PX;
  const border = TEXTURE_BORDER_PX;
  const canvas = document.createElement('canvas');
  canvas.width = 2 * cell;
  canvas.height = cell;
  const context = canvas.getContext('2d')!;
  const color = `#${(HANDLE_COLOR >>> 8).toString(16).padStart(6, '0')}`;
  for (const [index, fill] of [[0, '#ffffff'], [1, color]] as const) {
    context.fillStyle = color;
    context.fillRect(index * cell, 0, cell, cell);
    context.fillStyle = fill;
    context.fillRect(index * cell + border, border, cell - 2 * border, cell - 2 * border);
  }
  return canvas;
}
