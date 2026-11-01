import { checkExists } from 'external/dev_april_corgi+/js/common/asserts';

import { Vec2 } from 'js/map/common/types';
import { Renderer } from 'js/map/rendering/renderer';

import { getImageUrl } from '../model/images';

// Each image gets a square this big in the texture. A highlighted image draws 43 px across (see
// FeatureLayer#IMAGE_RADIUS_PX and #radiusPx), so this is twice that for high density screens,
// rounded up to a power of 2.
const CELL_PX = 128;
// 16 * 16 = 256 images fit in a 2048 px texture.
const CELLS_PER_SIDE = 16;
export const IMAGE_ATLAS_SIZE: Vec2 = [CELLS_PER_SIDE, CELLS_PER_SIDE];
// Label plans run every frame while zooming, so a failed image waits this long before a plan asks
// for it again.
const RETRY_MS = 10_000;

/**
 * Holds the image icons points show in one texture, each cropped to a circle in its own
 * square, for BillboardProgram to draw.
 *
 * If more images are on screen than the texture has squares, they keep evicting each other on
 * every plan and get fetched again from the browser's cache. That takes 256 image points in view
 * at once, so I accept it.
 */
export class ImageIcons {

  private readonly cells: Map<string, number>;
  private readonly owners: Array<string|undefined>;
  // The plan each square was last used in, so we can evict the one that has gone unused longest
  private readonly lastUsed: number[];
  private plan: number;
  // Images that are loading, that 404ed, or that failed recently enough to not retry yet
  private readonly requested: Set<string>;
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  readonly texture: WebGLTexture;
  // Set when the canvas has images the texture lacks
  private dirty: boolean;

  constructor(private readonly renderer: Renderer, private readonly loaded: () => void) {
    this.cells = new Map();
    this.owners = new Array(CELLS_PER_SIDE * CELLS_PER_SIDE).fill(undefined);
    this.lastUsed = new Array(CELLS_PER_SIDE * CELLS_PER_SIDE).fill(-1);
    this.plan = 0;
    this.requested = new Set();
    this.canvas = document.createElement('canvas');
    this.canvas.width = CELLS_PER_SIDE * CELL_PX;
    this.canvas.height = CELLS_PER_SIDE * CELL_PX;
    this.context = checkExists(this.canvas.getContext('2d'));
    this.texture = renderer.createTexture();
    this.dirty = false;
  }

  dispose(): void {
    this.renderer.deleteTexture(this.texture);
  }

  /**
   * Starts a new plan and uploads any images placed since the last one. Squares that getCell
   * returns after this count as used by it.
   */
  startPlan(): void {
    this.plan += 1;
    if (this.dirty) {
      this.renderer.uploadTexture(this.canvas, this.texture);
      this.dirty = false;
    }
  }

  /** Returns the image's square, or undefined while it loads or if it failed to load. */
  getCell(id: string): number|undefined {
    const cell = this.cells.get(id);
    if (cell !== undefined) {
      this.lastUsed[cell] = this.plan;
      return cell;
    }
    if (!this.requested.has(id)) {
      this.load(id);
    }
    return undefined;
  }

  private load(id: string): void {
    this.requested.add(id);
    let gone = false;
    fetch(getImageUrl(id, 'thumbnail'))
        .then(async response => {
          gone = response.status === 404;
          if (!response.ok) {
            throw new Error(`Image ${id} failed with ${response.status}`);
          }
          return createImageBitmap(await response.blob());
        })
        .then(bitmap => {
          this.requested.delete(id);
          this.place(id, bitmap);
          bitmap.close();
        })
        .catch(e => {
          console.error(e);
          if (!gone) {
            setTimeout(() => {
              this.requested.delete(id);
            }, RETRY_MS);
          }
        });
  }

  private place(id: string, bitmap: ImageBitmap): void {
    let cell = this.owners.indexOf(undefined);
    if (cell < 0) {
      cell = 0;
      for (let i = 1; i < this.lastUsed.length; ++i) {
        if (this.lastUsed[i] < this.lastUsed[cell]) {
          cell = i;
        }
      }
      this.cells.delete(checkExists(this.owners[cell]));
    }
    this.owners[cell] = id;
    this.cells.set(id, cell);
    this.lastUsed[cell] = this.plan;
    this.draw(cell, bitmap);
    this.dirty = true;
    this.loaded();
  }

  // Fills the circle with the middle of the image, cropping whichever edges stick out.
  private draw(cell: number, bitmap: ImageBitmap): void {
    const context = this.context;
    const x = (cell % CELLS_PER_SIDE) * CELL_PX;
    const y = Math.floor(cell / CELLS_PER_SIDE) * CELL_PX;
    const radius = CELL_PX / 2;
    context.clearRect(x, y, CELL_PX, CELL_PX);
    context.save();
    context.beginPath();
    context.arc(x + radius, y + radius, radius, 0, 2 * Math.PI);
    context.clip();
    const side = Math.min(bitmap.width, bitmap.height);
    context.imageSmoothingQuality = 'high';
    context.drawImage(
        bitmap,
        (bitmap.width - side) / 2,
        (bitmap.height - side) / 2,
        side,
        side,
        x,
        y,
        CELL_PX,
        CELL_PX);
    context.restore();
  }
}
