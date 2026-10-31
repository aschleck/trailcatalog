import { Vec2 } from 'js/map/common/types';

const COLLISION_CELL_PX = 64;

// Boxes bucketed by cell. Unlike label_placer.ts#CollisionGrid it has no bounds, because labels
// plan across the whole collection, which can span the world at any zoom.
export class LabelCollisions {

  // Every box inserted, flattened
  readonly boxes: number[];
  private readonly cells: Map<string, number[]>;

  constructor() {
    this.boxes = [];
    this.cells = new Map();
  }

  /** Returns whether any of the flattened x0,y0,x1,y1 boxes overlaps one inserted before. */
  hits(boxes: number[]): boolean {
    for (let i = 0; i < boxes.length; i += 4) {
      const [x0, y0, x1, y1] = [boxes[i], boxes[i + 1], boxes[i + 2], boxes[i + 3]];
      for (const key of cellKeys(x0, y0, x1, y1)) {
        const cell = this.cells.get(key) ?? [];
        for (let j = 0; j < cell.length; j += 4) {
          if (x0 < cell[j + 2] && cell[j + 0] < x1 && y0 < cell[j + 3] && cell[j + 1] < y1) {
            return true;
          }
        }
      }
    }
    return false;
  }

  insert(boxes: number[]): void {
    this.boxes.push(...boxes);
    for (let i = 0; i < boxes.length; i += 4) {
      const [x0, y0, x1, y1] = [boxes[i], boxes[i + 1], boxes[i + 2], boxes[i + 3]];
      for (const key of cellKeys(x0, y0, x1, y1)) {
        const cell = this.cells.get(key);
        if (cell) {
          cell.push(x0, y0, x1, y1);
        } else {
          this.cells.set(key, [x0, y0, x1, y1]);
        }
      }
    }
  }
}

/** Returns the x0,y0,x1,y1 box of a label that starts at left and is centered on y, plus pad. */
export function getLabelBox(left: number, y: number, size: Vec2, pad: number): number[] {
  return [left - pad, y - size[1] / 2 - pad, left + size[0] + pad, y + size[1] / 2 + pad];
}

function cellKeys(x0: number, y0: number, x1: number, y1: number): string[] {
  const keys = [];
  for (let y = Math.floor(y0 / COLLISION_CELL_PX); y <= Math.floor(y1 / COLLISION_CELL_PX); ++y) {
    for (let x = Math.floor(x0 / COLLISION_CELL_PX); x <= Math.floor(x1 / COLLISION_CELL_PX); ++x) {
      keys.push(`${x},${y}`);
    }
  }
  return keys;
}
