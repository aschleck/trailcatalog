import { ScreenProjection } from '../camera';
import { Vec2 } from '../common/types';
import { FONT_SIZE, GLYPHER } from '../rendering/glypher';
import { Drawable } from '../rendering/program';
import { Renderer } from '../rendering/renderer';
import { FLOATS_PER_PLACEMENT, Glyph } from '../rendering/sdf_program';
import { Label } from '../workers/mbtile_loader';

// Labels this far past the edge of the screen still place, so a label slides in rather than
// appearing once its anchor crosses the edge and knocking out whatever had been there.
const MARGIN_PX = 64;
// Added around every box, so neighboring labels keep twice this between their ink.
const PAD_PX = 6;
// The closest two labels with the same text may be. See line_labels#lineAnchors for how line
// anchors thin to it.
const REPEAT_PX = 200;
const CELL_PX = 64;

export interface LabelCandidate extends Label {
  key: string;
  text: string;
}

/** Boxes in screen pixels, bucketed into a grid so a query only tests the boxes near it. */
export class CollisionGrid {

  private readonly boxes: number[];
  private readonly cells: number[][];
  private columns: number;
  private rows: number;
  private originX: number;
  private originY: number;

  constructor() {
    this.boxes = [];
    this.cells = [];
    this.columns = 0;
    this.rows = 0;
    this.originX = 0;
    this.originY = 0;
  }

  /** Empties the grid and sizes it to cover low to high. */
  reset(lowX: number, lowY: number, highX: number, highY: number): void {
    this.boxes.length = 0;
    this.columns = Math.max(1, Math.ceil((highX - lowX) / CELL_PX));
    this.rows = Math.max(1, Math.ceil((highY - lowY) / CELL_PX));
    this.originX = lowX;
    this.originY = lowY;
    const count = this.columns * this.rows;
    for (let i = 0; i < count; ++i) {
      if (i < this.cells.length) {
        this.cells[i].length = 0;
      } else {
        this.cells.push([]);
      }
    }
  }

  hits(x0: number, y0: number, x1: number, y1: number): boolean {
    const [c0, r0, c1, r1] = this.cellRange(x0, y0, x1, y1);
    const boxes = this.boxes;
    for (let r = r0; r <= r1; ++r) {
      for (let c = c0; c <= c1; ++c) {
        for (const i of this.cells[r * this.columns + c]) {
          if (x0 < boxes[i + 2] && boxes[i + 0] < x1 && y0 < boxes[i + 3] && boxes[i + 1] < y1) {
            return true;
          }
        }
      }
    }
    return false;
  }

  insert(x0: number, y0: number, x1: number, y1: number): void {
    const i = this.boxes.length;
    this.boxes.push(x0, y0, x1, y1);
    const [c0, r0, c1, r1] = this.cellRange(x0, y0, x1, y1);
    for (let r = r0; r <= r1; ++r) {
      for (let c = c0; c <= c1; ++c) {
        this.cells[r * this.columns + c].push(i);
      }
    }
  }

  private cellRange(x0: number, y0: number, x1: number, y1: number):
      [number, number, number, number] {
    const column = (x: number) =>
        Math.min(this.columns - 1, Math.max(0, Math.floor((x - this.originX) / CELL_PX)));
    const row = (y: number) =>
        Math.min(this.rows - 1, Math.max(0, Math.floor((y - this.originY) / CELL_PX)));
    return [column(x0), row(y0), column(x1), row(y1)];
  }
}

/**
 * Compares labels by how much placement wants them, most first. Nothing about load order or the
 * camera goes into it, so the same labels win every frame.
 */
export function compareLabels(a: LabelCandidate, b: LabelCandidate): number {
  if (a.z !== b.z) {
    return b.z - a.z;
  } else if (a.rank !== b.rank) {
    return b.rank - a.rank;
  } else {
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  }
}

/**
 * Places labels in screen space every frame, walking them in priority order and keeping each one
 * that clears the ones already placed and every same-text label closer than REPEAT_PX. Among
 * labels of the same z, the ones placed the frame before go first.
 */
export class LabelPlacer {

  private readonly glyphs: Glyph[];
  private readonly grid: CollisionGrid;
  private readonly placements: number[];
  private readonly point: [number, number];
  // Screen pixels of the placed labels, by their text
  private readonly repeats: Map<string, number[]>;
  // The keys of the labels the last call placed
  private placed: Set<string>;

  constructor() {
    this.glyphs = [];
    this.grid = new CollisionGrid();
    this.placements = [];
    this.point = [0, 0];
    this.repeats = new Map();
    this.placed = new Set();
  }

  /** Plans the labels that fit into buffer and returns what it wrote. */
  place(
      sorted: ReadonlyArray<LabelCandidate>,
      projection: ScreenProjection,
      zoom: number,
      buffer: ArrayBuffer,
      glBuffer: WebGLBuffer,
      renderer: Renderer): {byteSize: number; drawables: Drawable[]} {
    const halfWidth = projection.widthPx / 2 + MARGIN_PX;
    const halfHeight = projection.heightPx / 2 + MARGIN_PX;
    this.grid.reset(-halfWidth, -halfHeight, halfWidth, halfHeight);
    this.repeats.clear();

    // Pixels per mercator unit, the same scale the programs get as halfWorldSize. Glyph advances
    // are in pixels and label paths are in mercator, so curved layout needs the live conversion.
    const pixelsPerWorld = 256 * Math.pow(2, zoom - 1);
    const out = {byteSize: 0, drawables: [] as Drawable[]};
    const placed = new Set<string>();
    groups: for (let start = 0; start < sorted.length;) {
      let end = start + 1;
      while (end < sorted.length && sorted[end].z === sorted[start].z) {
        end += 1;
      }

      // The labels placed last time go first among their z, so a label only gives up its place
      // to one that outranks it. Or else zooming carries one copy of a name past REPEAT_PX from
      // the next, which knocks out the copy after that, and the change runs down the whole line.
      for (const previously of [true, false]) {
        for (let i = start; i < end; ++i) {
          const label = sorted[i];
          if (this.placed.has(label.key) !== previously) {
            continue;
          }

          const result =
              this.tryPlace(
                  label, projection, pixelsPerWorld, halfWidth, halfHeight, buffer, glBuffer,
                  renderer, out);
          if (result === 'full') {
            break groups;
          } else if (result === 'placed') {
            placed.add(label.key);
          }
        }
      }
      start = end;
    }
    this.placed = placed;
    return out;
  }

  private tryPlace(
      label: LabelCandidate,
      projection: ScreenProjection,
      pixelsPerWorld: number,
      halfWidth: number,
      halfHeight: number,
      buffer: ArrayBuffer,
      glBuffer: WebGLBuffer,
      renderer: Renderer,
      out: {byteSize: number; drawables: Drawable[]}): 'full'|'placed'|'skipped' {
    const point = this.point;
    if (!projection.project(label.center[0], label.center[1], point)) {
      return 'skipped';
    }
    const [x, y] = point;
    if (Math.abs(x) > halfWidth
        || Math.abs(y) > halfHeight
        || this.repeatsNear(label.text, x, y)) {
      return 'skipped';
    }

    if (out.byteSize + GLYPHER.bytesNeeded(label.graphemes) > buffer.byteLength) {
      return 'full';
    }

    const planned =
        label.path
            ? this.placeCurved(
                label, label.path, projection, pixelsPerWorld, buffer, out.byteSize, glBuffer,
                renderer)
            : this.placeStraight(label, x, y, buffer, out.byteSize, glBuffer, renderer);
    if (!planned) {
      return 'skipped';
    }

    for (const drawable of planned.drawables) {
      out.drawables.push(drawable);
    }
    out.byteSize += planned.byteSize;
    const repeats = this.repeats.get(label.text);
    if (repeats) {
      repeats.push(x, y);
    } else {
      this.repeats.set(label.text, [x, y]);
    }
    return 'placed';
  }

  private placeCurved(
      label: Label,
      path: number[],
      projection: ScreenProjection,
      pixelsPerWorld: number,
      buffer: ArrayBuffer,
      offset: number,
      glBuffer: WebGLBuffer,
      renderer: Renderer): {byteSize: number; drawables: Drawable[]}|undefined {
    const glyphs = this.glyphs;
    const placements = this.placements;
    if (!GLYPHER.layOutCurved(
        label.graphemes, path, pixelsPerWorld, label.scale, glyphs, placements)) {
      return undefined;
    }

    // Placements hang off the head of the path.
    const head = this.point;
    if (!projection.project(path[0], path[1], head)) {
      return undefined;
    }
    const [hx, hy] = head;

    // Each glyph gets a square as tall as the font, centered half an advance on from its pen
    // along its own angle. It ignores the rotation, which costs a little space on steep text.
    const half = FONT_SIZE * label.scale / 2 + PAD_PX;
    for (let pass = 0; pass < 2; ++pass) {
      for (let i = 0; i < glyphs.length; ++i) {
        const advance = glyphs[i].glyphAdvance * label.scale / 2;
        const angle = placements[FLOATS_PER_PLACEMENT * i + 2];
        const cx = hx + placements[FLOATS_PER_PLACEMENT * i + 0] + advance * Math.cos(angle);
        const cy = hy + placements[FLOATS_PER_PLACEMENT * i + 1] + advance * Math.sin(angle);
        if (pass === 0) {
          if (this.grid.hits(cx - half, cy - half, cx + half, cy + half)) {
            return undefined;
          }
        } else {
          this.grid.insert(cx - half, cy - half, cx + half, cy + half);
        }
      }
    }

    return GLYPHER.planPlaced(
        glyphs,
        [path[0], path[1]],
        placements,
        label.scale,
        label.fill,
        label.stroke,
        label.z,
        buffer,
        offset,
        glBuffer,
        renderer);
  }

  private placeStraight(
      label: Label,
      x: number,
      y: number,
      buffer: ArrayBuffer,
      offset: number,
      glBuffer: WebGLBuffer,
      renderer: Renderer): {byteSize: number; drawables: Drawable[]}|undefined {
    const size = GLYPHER.measurePx(label.graphemes, label.scale);
    if (!size) {
      return undefined;
    }

    const cos = Math.abs(Math.cos(label.angle));
    const sin = Math.abs(Math.sin(label.angle));
    const halfX = (size[0] * cos + size[1] * sin) / 2 + PAD_PX;
    const halfY = (size[0] * sin + size[1] * cos) / 2 + PAD_PX;
    if (this.grid.hits(x - halfX, y - halfY, x + halfX, y + halfY)) {
      return undefined;
    }
    this.grid.insert(x - halfX, y - halfY, x + halfX, y + halfY);

    return GLYPHER.plan(
        label.graphemes,
        label.center,
        [0, 0],
        label.scale,
        label.angle,
        label.fill,
        label.stroke,
        label.z,
        buffer,
        offset,
        glBuffer,
        renderer);
  }

  private repeatsNear(text: string, x: number, y: number): boolean {
    const repeats = this.repeats.get(text);
    if (!repeats) {
      return false;
    }
    for (let i = 0; i < repeats.length; i += 2) {
      const dx = repeats[i + 0] - x;
      const dy = repeats[i + 1] - y;
      if (dx * dx + dy * dy < REPEAT_PX * REPEAT_PX) {
        return true;
      }
    }
    return false;
  }
}
