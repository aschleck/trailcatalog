import TinySDF from '@mapbox/tiny-sdf';

import { checkExists } from 'external/dev_april_corgi+/js/common/asserts';
import { TFontFace, parseCss } from 'external/dev_april_corgi+/js/common/css';
import { Disposable } from 'external/dev_april_corgi+/js/common/disposable';

import { RgbaU32, Vec2 } from '../common/types';

import { Drawable } from './program';
import { Renderer } from './renderer';
import { FLOATS_PER_PLACEMENT, Glyph, SdfProgram } from './sdf_program';
import { TexturePool } from './texture_pool';

interface LoadAwareFontFace extends TFontFace {
  requested?: boolean;
  loaded?: boolean;
}

export const FONT_SIZE = 28;
const LINE_HEIGHT = 1.2;
// TinySDF's default, which we don't override: the SDF bitmap is the ink with this much padding on
// each side.
const SDF_BUFFER_PX = 3;
// How far above and left of its cell's center a glyph's SDF bitmap starts, which is where the
// quads plan draws expect the ink.
const BITMAP_INSET_PX = 16;
// TinySDF clamps ink to FONT_SIZE + 3 * SDF_BUFFER_PX, so its widest bitmap reaches
// FONT_SIZE + 5 * SDF_BUFFER_PX - BITMAP_INSET_PX = 27px past the center and needs half a cell
// that big, or else wide glyphs like emoji lose their right and bottom edges.
const ATLAS_GLYPH_SIZE = 64;

const ATLAS_WIDTH = 2048;
const ATLAS_HEIGHT = 2048;
const SEGMENTER = new Intl.Segmenter();

// Scratch for planCurved, which runs once per curved label per frame.
const PLACEMENTS: number[] = [];
const CURVED_GLYPHS: Glyph[] = [];
// Scratch for layOutAlong, the ends of the chord under one glyph.
const PEN_START: [number, number] = [0, 0];
const PEN_END: [number, number] = [0, 0];
// Scratch for plan, one horizontal anchor shift per line.
const LINE_SHIFTS: number[] = [];

/** Where on text's ink an offset lands, see Glypher#plan. */
export interface TextAnchor {
  horizontal: 'start'|'center';
  vertical: 'middle';
}

class Glypher {

  private readonly atlas: Uint8Array;
  private readonly atlasUploads: WeakMap<Renderer, number>;
  private readonly characters: Set<string>;
  private readonly fonts: Array<[start: number, end: number, font: LoadAwareFontFace]>;
  private readonly glyphs: Map<String, Glyph>;
  private readonly listeners: Set<() => void>;
  private regenerationScheduled: boolean;
  private readonly tinySdf: TinySDF;
  private cssFetched: boolean;
  private generation: number;

  constructor() {
    this.atlas = new Uint8Array(ATLAS_WIDTH * ATLAS_HEIGHT);
    this.atlasUploads = new WeakMap();
    this.characters = new Set();
    this.fonts = [];
    this.glyphs = new Map();
    this.listeners = new Set();
    this.regenerationScheduled = false;
    this.cssFetched = false;
    this.generation = -1;

    // Avoid both ssr and web workers.
    this.tinySdf =
      typeof window === 'undefined' || !process.env.CORGI_FOR_BROWSER
          ? undefined as unknown as TinySDF
          : new TinySDF({
            fontSize: FONT_SIZE,
            fontFamily: 'Roboto,"Noto Emoji",sans-serif',
            fontStyle: 'normal',
            fontWeight: '400',
          });

    for (let i = 32; i < 127; ++i) {
      this.characters.add(String.fromCodePoint(i));
    }
  }

  addListener(listener: () => void): Disposable {
    this.listeners.add(listener);
    const listening = new Disposable();
    listening.registerDisposer(() => { this.listeners.delete(listener); });
    return listening;
  }

  /** Upper bound on bytes that {@link plan} will write for the given graphemes. */
  bytesNeeded(graphemes: string[]): number {
    let glyphCount = 0;
    for (const c of graphemes) {
      if (c !== '\n') {
        glyphCount += 1;
      }
    }
    return SdfProgram.bytesNeeded(glyphCount);
  }

  measurePx(graphemes: string[], scale: number): Vec2|undefined {
    let regenerate = false;
    let lineWidth = 0;
    let yHeight = 0;
    let xWidth = 0;
    for (const character of graphemes) {
      if (character === '\n') {
        xWidth = Math.max(lineWidth, xWidth);
        yHeight += FONT_SIZE * scale * LINE_HEIGHT;
        lineWidth = 0;
        continue;
      }

      const glyph = this.glyphs.get(character);
      if (glyph) {
        lineWidth += glyph.glyphAdvance * scale;
      } else {
        this.characters.add(character);
        regenerate = true;

        // Make something reasonable up
        lineWidth += FONT_SIZE * 0.6 * scale;
      }
    }
    xWidth = Math.max(lineWidth, xWidth);
    yHeight += FONT_SIZE * scale;

    if (regenerate) {
      this.scheduleRegeneration();
      return undefined;
    }

    return [xWidth, yHeight];
  }

  /**
   * Lays text out at an offset from center. Without an anchor, the offset is the middle of the
   * text's advance and near its baseline. An anchor puts the text's ink there instead: starting
   * there or centered on it across, and centered on it up and down, which is what a label beside
   * a marker or a symbol standing in for a place needs. Each line of multi-line text meets the anchor
   * on its own, and the block is centered up and down.
   */
  plan(
      graphemes: string[],
      center: Vec2,
      offsetPx: Vec2,
      scale: number,
      angle: number,
      fill: RgbaU32,
      stroke: RgbaU32,
      z: number,
      buffer: ArrayBuffer,
      offset: number,
      glBuffer: WebGLBuffer,
      renderer: Renderer,
      anchor?: TextAnchor): {byteSize: number; drawables: Drawable[];} {
    let regenerate = false;
    let yHeight = 0;
    for (const character of graphemes) {
      if (character === '\n') {
        yHeight += FONT_SIZE * scale * LINE_HEIGHT;
        continue;
      }

      const glyph = this.glyphs.get(character);
      if (!glyph) {
        this.characters.add(character);
        regenerate = true;
      }
    }
    // TODO(april): no idea why this is negative...
    yHeight -= FONT_SIZE * scale;

    if (regenerate) {
      this.scheduleRegeneration();
      return {byteSize: 0, drawables: []};
    }

    if (this.atlasUploads.get(renderer) !== this.generation) {
      renderer.uploadAlphaTexture(
          this.atlas, [ATLAS_WIDTH, ATLAS_HEIGHT], renderer.sdfProgram.atlas);
      this.atlasUploads.set(renderer, this.generation);
    }

    const drawables = [];
    const pending = [];
    let totalByteSize = 0;
    let yOffset = yHeight / 2;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const dy = anchor ? this.anchorShift(graphemes, scale, yOffset, anchor, LINE_SHIFTS) : 0;
    let line = 0;
    for (let i = 0; i <= graphemes.length; ++i) {
      const character = graphemes[i];
      if (i < graphemes.length && character !== '\n') {
        pending.push(checkExists(this.glyphs.get(character)));
        continue;
      }

      if (pending.length > 0) {
        const dx = anchor ? LINE_SHIFTS[line] : 0;
        const {byteSize, drawable} = renderer.sdfProgram.plan(
            pending,
            center,
            [
              offsetPx[0] + dx * cos - (dy + yOffset) * sin,
              offsetPx[1] + dx * sin + (dy + yOffset) * cos,
            ],
            scale,
            angle,
            fill,
            stroke,
            z,
            [ATLAS_WIDTH / ATLAS_GLYPH_SIZE, ATLAS_HEIGHT / ATLAS_GLYPH_SIZE],
            buffer,
            offset + totalByteSize,
            glBuffer);
        drawables.push(drawable);
        totalByteSize += byteSize;
      }

      pending.length = 0;
      yOffset -= FONT_SIZE * scale * LINE_HEIGHT;
      line += 1;
    }

    return {
      byteSize: totalByteSize,
      drawables,
    };
  }

  // How far to move text from where plan puts it without an anchor so its ink meets the anchor,
  // in the text's own frame. Each line moves across by its own ink, written into lineShifts, and
  // the block moves up or down by the ink of every line, which we return. Each quad is centered on
  // the pen, which starts half its line's advance back, and raised by its glyph's top from its
  // line's yOffset, while the ink hangs from BITMAP_INSET_PX up and left of the quad's center.
  private anchorShift(
      graphemes: string[],
      scale: number,
      yOffset: number,
      anchor: TextAnchor,
      lineShifts: number[]): number {
    lineShifts.length = 0;
    let top = -Infinity;
    let bottom = Infinity;
    let start = 0;
    for (let end = 0; end <= graphemes.length; ++end) {
      if (end < graphemes.length && graphemes[end] !== '\n') {
        continue;
      }

      let advance = 0;
      for (let i = start; i < end; ++i) {
        advance += checkExists(this.glyphs.get(graphemes[i])).glyphAdvance * scale;
      }

      let pen = -advance / 2;
      let left = Infinity;
      let right = -Infinity;
      for (let i = start; i < end; ++i) {
        const glyph = checkExists(this.glyphs.get(graphemes[i]));
        if (glyph.glyphWidth > 0) {
          const inkLeft = pen - (BITMAP_INSET_PX - SDF_BUFFER_PX) * scale;
          const inkTop = yOffset + (glyph.glyphTop + BITMAP_INSET_PX - SDF_BUFFER_PX) * scale;
          left = Math.min(left, inkLeft);
          right = Math.max(right, inkLeft + glyph.glyphWidth * scale);
          top = Math.max(top, inkTop);
          bottom = Math.min(bottom, inkTop - glyph.glyphHeight * scale);
        }
        pen += glyph.glyphAdvance * scale;
      }
      if (left > right) {
        lineShifts.push(0);
      } else {
        lineShifts.push(anchor.horizontal === 'start' ? -left : -(left + right) / 2);
      }

      yOffset -= FONT_SIZE * scale * LINE_HEIGHT;
      start = end + 1;
    }

    return bottom > top ? 0 : -(top + bottom) / 2;
  }

  /**
   * Lays glyphs out along a mercator polyline, stepping one glyph advance at a time and rotating
   * each glyph to the segment it lands on. Draws nothing if the text is longer than the path,
   * because a label that runs off the end of its road reads as belonging to a different one.
   *
   * pixelsPerWorld converts glyph advances, which are in pixels, into the mercator units the path
   * is in, so this has to run at render time against the live zoom.
   */
  planCurved(
      graphemes: string[],
      path: ArrayLike<number>,
      pixelsPerWorld: number,
      scale: number,
      fill: RgbaU32,
      stroke: RgbaU32,
      z: number,
      buffer: ArrayBuffer,
      offset: number,
      glBuffer: WebGLBuffer,
      renderer: Renderer): {byteSize: number; drawables: Drawable[];} {
    if (!this.layOutCurved(graphemes, path, pixelsPerWorld, scale, CURVED_GLYPHS, PLACEMENTS)
        || turnsTooSharply(PLACEMENTS)) {
      return {byteSize: 0, drawables: []};
    }
    return this.planPlaced(
        CURVED_GLYPHS,
        // The glyphs hang off the head of the path, so that is the label's anchor.
        [path[0], path[1]],
        PLACEMENTS,
        scale,
        fill,
        stroke,
        z,
        buffer,
        offset,
        glBuffer,
        renderer);
  }

  /**
   * Fills glyphs and placements with text laid along path, see planCurved, and returns false when
   * the text doesn't fit it. Placements are pixel offsets from the head of the path, with y up.
   *
   * Unlike planCurved this allows any bend, because whether a glyph lands across a sharp vertex
   * changes with every step of zoom and the label would flicker. Callers that place the same label
   * across zooms check the bend once against MAX_GLYPH_TURN instead.
   */
  layOutCurved(
      graphemes: string[],
      path: ArrayLike<number>,
      pixelsPerWorld: number,
      scale: number,
      glyphs: Glyph[],
      placements: number[],
      keepDirection: boolean = false): boolean {
    glyphs.length = 0;
    let regenerate = false;
    let widthPx = 0;
    for (const character of graphemes) {
      if (character === '\n') {
        continue;
      }

      const glyph = this.glyphs.get(character);
      if (glyph) {
        glyphs.push(glyph);
        widthPx += glyph.glyphAdvance * scale;
      } else {
        this.characters.add(character);
        regenerate = true;
      }
    }

    if (regenerate) {
      this.scheduleRegeneration();
      return false;
    }

    const points = path.length / 2;
    let length = 0;
    for (let i = 0; i + 1 < points; ++i) {
      length += distance(path, i, i + 1);
    }

    const width = widthPx / pixelsPerWorld;
    if (width > length) {
      return false;
    }

    // Lay the text out and then see which way it came out reading. Deciding from the path's two
    // endpoints instead gets it wrong wherever a line doubles back, because the ends point one
    // way while the stretch under the text points the other.
    const heading =
        layOutAlong(glyphs, path, length, width, pixelsPerWorld, scale, true, placements);
    if (heading < 0 && !keepDirection) {
      layOutAlong(glyphs, path, length, width, pixelsPerWorld, scale, false, placements);
    }

    return true;
  }

  /** Draws glyphs at their own offsets from center, as layOutCurved places them. */
  planPlaced(
      glyphs: Glyph[],
      center: Vec2,
      placements: ArrayLike<number>,
      scale: number,
      fill: RgbaU32,
      stroke: RgbaU32,
      z: number,
      buffer: ArrayBuffer,
      offset: number,
      glBuffer: WebGLBuffer,
      renderer: Renderer): {byteSize: number; drawables: Drawable[];} {
    if (this.atlasUploads.get(renderer) !== this.generation) {
      renderer.uploadAlphaTexture(
          this.atlas, [ATLAS_WIDTH, ATLAS_HEIGHT], renderer.sdfProgram.atlas);
      this.atlasUploads.set(renderer, this.generation);
    }

    const {byteSize, drawable} =
        renderer.sdfProgram.planPlaced(
            glyphs,
            center,
            placements,
            scale,
            fill,
            stroke,
            z,
            [ATLAS_WIDTH / ATLAS_GLYPH_SIZE, ATLAS_HEIGHT / ATLAS_GLYPH_SIZE],
            buffer,
            offset,
            glBuffer);
    return {byteSize, drawables: [drawable]};
  }

  // A request never postpones one already scheduled, or else callers that retry until a glyph
  // exists, like MbtileLayer#loadProcessedTile, take turns pushing the regeneration behind each
  // other's retries and it never runs.
  private scheduleRegeneration(): void {
    if (this.regenerationScheduled) {
      return;
    }
    this.regenerationScheduled = true;
    setTimeout(() => {
      this.regenerationScheduled = false;
      this.regenerate();
    });
  }

  private regenerate(): void {
    if (!this.cssFetched) {
      this.cssFetched = true;
      fetch('https://fonts.googleapis.com/css2?family=Noto+Emoji&family=Roboto')
          .then(response => response.text())
          .then(text => {
            for (const face of parseCss(text)) {
              for (const [start, end] of face.ranges) {
                this.fonts.push([start, end, face]);
              }
            }
            this.fonts.sort((a, b) => a[0] - b[0]);
            this.regenerate();
          })
          .catch(e => {
            console.error(e);
          });
      return;
    }

    if (this.fonts.length === 0) {
      return;
    }

    let missing = false;
    for (const character of this.characters) {
      for (const code of Array.from(character)) {
        const codepoint = code.codePointAt(0) ?? 0;
        if (codepoint === 0x200D) {
          // Zero width joiner
          continue;
        } else if (codepoint === 0xFE0E || codepoint === 0xFE0F) {
          // Variational selector
          continue;
        }

        for (const [start, end, font] of this.fonts) {
          if (codepoint >= end) {
            continue;
          }
          if (codepoint < start) {
            break;
          }

          if (!font.loaded) {
            missing = true;
            if (!font.requested) {
              const face = new FontFace(font.family, font.src);
              document.fonts.add(face);
              face.load()
                  .then(() => {
                    font.loaded = true;
                    this.scheduleRegeneration();
                  });
              font.requested = true;
            }
          }
        }
      }
    }

    if (missing) {
      return;
    }

    const size = ATLAS_GLYPH_SIZE;
    let i = 0;
    this.glyphs.clear();
    for (const character of this.characters) {
      const x = i % (ATLAS_WIDTH / size) * size;
      const y = Math.floor(i / (ATLAS_WIDTH / size)) * size;
      const g = this.tinySdf.draw(character);
      const inset = size / 2 - BITMAP_INSET_PX;
      copyIntoImage(g.data, g.width, this.atlas, x + inset, y + inset, ATLAS_WIDTH);
      this.glyphs.set(character, {
        index: i,
        glyphAdvance: g.glyphAdvance,
        glyphWidth: g.glyphWidth,
        glyphHeight: g.glyphHeight,
        glyphTop: g.glyphTop,
        width: size,
        height: size,
      });

      i += 1;
    }

    this.generation += 1;
    for (const listener of this.listeners) {
      listener();
    }
  }
}

export const GLYPHER = new Glypher();

// Fills placements with a center, a perpendicular offset, and an angle per glyph, walking the
// path from one end or the other. Returns how strongly the result reads left to right, which is
// negative when the text came out backwards.
function layOutAlong(
    glyphs: Glyph[],
    path: ArrayLike<number>,
    length: number,
    width: number,
    pixelsPerWorld: number,
    scale: number,
    forward: boolean,
    placements: number[]): number {
  const points = path.length / 2;
  const step = forward ? 1 : -1;
  const first = forward ? 0 : points - 1;

  placements.length = 0;
  let heading = 0;
  // Arc length from the start of the walk to the pen, centering the text on the path the same way
  // straight labels center on their anchor.
  let pen = (length - width) / 2;
  let segment = 0;
  let travelled = 0;
  let segmentLength = distance(path, first, first + step);
  // Writes the point at an arc length into out. Arc lengths only grow, so the walk only moves
  // forward.
  const pointAt = (at: number, out: [number, number]) => {
    while (at > travelled + segmentLength && segment + 2 < points) {
      travelled += segmentLength;
      segment += 1;
      segmentLength = distance(path, first + segment * step, first + (segment + 1) * step);
    }

    const from = 2 * (first + segment * step);
    const to = 2 * (first + (segment + 1) * step);
    const fraction = segmentLength > 0 ? (at - travelled) / segmentLength : 0;
    out[0] = path[from + 0] + fraction * (path[to + 0] - path[from + 0]);
    out[1] = path[from + 1] + fraction * (path[to + 1] - path[from + 1]);
  };

  const start = PEN_START;
  const end = PEN_END;
  pointAt(pen, end);
  for (const glyph of glyphs) {
    start[0] = end[0];
    start[1] = end[1];
    const advance = glyph.glyphAdvance * scale;
    pointAt(pen + advance / pixelsPerWorld, end);
    // The chord across the glyph's own advance, rather than whichever segment the pen is on, so
    // a glyph straddling a vertex leans with both sides of it.
    const angle = Math.atan2(end[1] - start[1], end[0] - start[0]);
    // Lifts the glyph off the baseline onto the line itself, matching plan's vertical centering.
    const perpendicular = glyph.glyphTop * scale - FONT_SIZE * scale / 2;
    // Offsets from the anchor rather than absolute positions, because these land in a float
    // buffer and mercator coordinates have no precision left to spare at high zoom.
    placements.push(
        (start[0] - path[0]) * pixelsPerWorld - Math.sin(angle) * perpendicular,
        (start[1] - path[1]) * pixelsPerWorld + Math.cos(angle) * perpendicular,
        angle);

    heading += advance * Math.cos(angle);
    pen += advance / pixelsPerWorld;
  }
  return heading;
}

// Text that bends more than this between two glyphs stops reading as one word following a curve.
// It happens where a line doubles back on itself, which puts the tail of the name on the return
// leg pointing at its own head.
export const MAX_GLYPH_TURN = Math.PI / 4;

function turnsTooSharply(placements: number[]): boolean {
  for (let i = 2 * FLOATS_PER_PLACEMENT - 1; i < placements.length; i += FLOATS_PER_PLACEMENT) {
    let turn = placements[i] - placements[i - FLOATS_PER_PLACEMENT];
    if (turn > Math.PI) {
      turn -= 2 * Math.PI;
    } else if (turn < -Math.PI) {
      turn += 2 * Math.PI;
    }

    if (Math.abs(turn) > MAX_GLYPH_TURN) {
      return true;
    }
  }
  return false;
}

// Distance between two points of a flat x,y array, by point index.
function distance(path: ArrayLike<number>, from: number, to: number): number {
  const dx = path[2 * to + 0] - path[2 * from + 0];
  const dy = path[2 * to + 1] - path[2 * from + 1];
  return Math.sqrt(dx * dx + dy * dy);
}

function copyIntoImage(
    data: Uint8ClampedArray,
    swidth: number,
    image: Uint8Array,
    dx: number,
    dy: number,
    dwidth: number): void {
  let i = 0;
  while (i < data.length) {
    for (let x = 0; x < swidth; ++x) {
      image[dy * dwidth + dx + x] = data[i];
      i += 1;
    }
    dy += 1;
  }
}

export function toGraphemes(text: string): string[] {
  return Array.from(SEGMENTER.segment(text), s => s.segment);
}

/**
 * Breaks lines at the first space once a line has run past lineGraphemes, so no word is split.
 */
export function wrap(graphemes: string[], lineGraphemes: number): string[] {
  const wrapped = [];
  let lastWrap = 0;
  for (let i = 0; i < graphemes.length; ++i) {
    if (i - lastWrap > lineGraphemes && graphemes[i] === ' ') {
      wrapped.push('\n');
      lastWrap = i;
    } else {
      wrapped.push(graphemes[i]);
    }
  }
  return wrapped;
}

/** Puts a hair space between the graphemes of each line, which letter-spaces the text. */
export function track(graphemes: string[]): string[] {
  const tracked = [];
  for (let i = 0; i < graphemes.length; ++i) {
    tracked.push(graphemes[i]);
    if (i + 1 < graphemes.length && graphemes[i] !== '\n' && graphemes[i + 1] !== '\n') {
      tracked.push('\u200A');
    }
  }
  return tracked;
}
