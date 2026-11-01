import TinySDF from '@mapbox/tiny-sdf';

import { checkExists } from 'external/dev_april_corgi+/js/common/asserts';
import { TFontFace, parseCss } from 'external/dev_april_corgi+/js/common/css';
import { Disposable } from 'external/dev_april_corgi+/js/common/disposable';

import { RgbaU32, Vec2 } from '../common/types';

import { Drawable } from './program';
import { Renderer } from './renderer';
import { FLOATS_PER_PLACEMENT, Glyph, HALO_EDGE, INK_EDGE, SDF_ATLAS_SIZE, SdfProgram } from './sdf_program';

interface LoadAwareFontFace extends TFontFace {
  requested?: boolean;
  loaded?: boolean;
}

// The fields of TinySDF that draw reads, which drawUnit grows past the one em they are sized for.
interface TinySdfInternals {
  buffer: number;
  ctx: CanvasRenderingContext2D|OffscreenCanvasRenderingContext2D;
  f: Float64Array;
  gridInner: Float64Array;
  gridOuter: Float64Array;
  maxGlyphDim: number;
  size: number;
  v: Uint16Array;
  z: Float64Array;
}

// Fonts in the order the canvas tries them. A code point is drawn in the first family whose
// unicode-range has it, and the Noto Sans scripts all cover Latin and the emoji blocks, so Roboto
// and Noto Emoji come first.
const FONT_FAMILIES = [
  'Roboto',
  'Noto Emoji',
  'Noto Sans Arabic',
  'Noto Sans Armenian',
  'Noto Sans Bengali',
  'Noto Sans Devanagari',
  'Noto Sans Ethiopic',
  'Noto Sans Georgian',
  'Noto Sans Gujarati',
  'Noto Sans Gurmukhi',
  'Noto Sans Hebrew',
  'Noto Sans Kannada',
  'Noto Sans Khmer',
  'Noto Sans Lao',
  'Noto Sans Malayalam',
  'Noto Sans Myanmar',
  'Noto Sans Sinhala',
  'Noto Sans Tamil',
  'Noto Sans Telugu',
  'Noto Sans Thai',
];
const FONT_FAMILY = FONT_FAMILIES.map(family => `"${family}"`).join(',') + ',sans-serif';

export const FONT_SIZE = 28;
const LINE_HEIGHT = 1.2;
// We rasterize glyphs this many times larger than FONT_SIZE because TinySDF rounds off corners and
// thin joins at about a pixel of its own bitmap, which is two screen pixels for a label drawn at
// FONT_SIZE / 2 on a 2x display. The constants below are in FONT_SIZE pixels and the atlas is in
// SDF_SCALE times that.
const SDF_SCALE = 2;
// TinySDF's defaults: the SDF bitmap is the ink with this much padding on each side, and the
// distance field spans this far either side of the edge.
const SDF_BUFFER_PX = 3;
const SDF_RADIUS_PX = 8;
// How far above and left of its cell's center a glyph's SDF bitmap starts, which is where the
// quads plan draws expect the ink.
const BITMAP_INSET_PX = 16;
// A unit gets a cell as wide as its bitmap needs, in a row of cells this tall. A bitmap starts
// BITMAP_INSET_PX above the center, so a row holds ATLAS_GLYPH_SIZE / 2 + BITMAP_INSET_PX = 48px of
// it, which is 42px of ink between the padding.
const ATLAS_GLYPH_SIZE = 64;

// 2048 / 64 => 32 rows of cells, and 32 single graphemes to a row.
const [ATLAS_WIDTH, ATLAS_HEIGHT] = SDF_ATLAS_SIZE;
const SEGMENTER = new Intl.Segmenter();

const ATLAS_ROW_HEIGHT = ATLAS_GLYPH_SIZE * SDF_SCALE;
// Where in its cell a bitmap starts, across and down, in atlas pixels
const ATLAS_INSET = ATLAS_ROW_HEIGHT / 2 - BITMAP_INSET_PX * SDF_SCALE;

// Every Glyph the glypher hands out is one of these, so planPlaced can find out whether the glyphs
// layOutCurved measured have been drawn into the atlas yet.
interface AtlasGlyph extends Glyph {
  text: string;
  placed: boolean;
  // the generation that last drew the glyph, which eviction keeps
  drawnIn: number;
  // Set when even an evicted atlas has no room, so labels skip the glyph instead of asking for it
  // every frame. The next eviction clears it.
  unplaceable: boolean;
}

// Scratch for plan and planCurved, which run once per label per frame.
const PLACEMENTS: number[] = [];
const PLACED_GLYPHS: Glyph[] = [];
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
  // Units a label needs the size of, and units a label is ready to draw
  private readonly unmeasured: Set<string>;
  private readonly wanted: Set<string>;
  // Where the next cell goes in the atlas, in atlas pixels
  private cursorX: number;
  private cursorY: number;
  private readonly fonts:
      Array<[start: number, end: number, font: LoadAwareFontFace, priority: number]>;
  private readonly glyphs: Map<string, AtlasGlyph>;
  private readonly listeners: Set<() => void>;
  private regenerationScheduled: boolean;
  private readonly tinySdf: TinySDF;
  private cssFetched: boolean;
  private overflowed: boolean;
  private generation: number;
  // Bumps when the atlas's pixels change, which is less often than generation
  private atlasVersion: number;
  private evictions: number;
  // How much ink tinySdf can draw across and down, which drawUnit grows
  private sdfWidth: number;
  private sdfHeight: number;

  constructor() {
    this.atlas = new Uint8Array(ATLAS_WIDTH * ATLAS_HEIGHT);
    this.atlasUploads = new WeakMap();
    this.unmeasured = new Set();
    this.wanted = new Set();
    this.cursorX = 0;
    this.cursorY = 0;
    this.fonts = [];
    this.glyphs = new Map();
    this.listeners = new Set();
    this.regenerationScheduled = false;
    this.cssFetched = false;
    this.overflowed = false;
    this.generation = -1;
    this.atlasVersion = -1;
    this.evictions = 0;
    this.sdfWidth = 0;
    this.sdfHeight = 0;

    // Avoid both ssr and web workers.
    this.tinySdf =
        typeof window === 'undefined' || !process.env.CORGI_FOR_BROWSER
            ? undefined as unknown as TinySDF
            : new TinySDF({
              fontSize: FONT_SIZE * SDF_SCALE,
              buffer: SDF_BUFFER_PX * SDF_SCALE,
              radius: SDF_RADIUS_PX * SDF_SCALE,
              fontFamily: FONT_FAMILY,
              fontStyle: 'normal',
              fontWeight: '400',
            });

    for (let i = 32; i < 127; ++i) {
      this.unmeasured.add(String.fromCodePoint(i));
      this.wanted.add(String.fromCodePoint(i));
    }
  }

  /**
   * Changes whenever glyphs move in the atlas, after which anything planned earlier draws the wrong
   * cells and has to be planned again.
   */
  get placementGeneration(): number {
    return this.evictions;
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
    let measured = true;
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

      const glyph = this.getGlyph(character);
      if (glyph) {
        lineWidth += glyph.glyphAdvance * scale;
      } else {
        measured = false;
      }
    }
    xWidth = Math.max(lineWidth, xWidth);
    yHeight += FONT_SIZE * scale;
    return measured ? [xWidth, yHeight] : undefined;
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
    const glyphs = PLACED_GLYPHS;
    glyphs.length = 0;
    let measured = true;
    let yHeight = 0;
    for (const character of graphemes) {
      if (character === '\n') {
        yHeight += FONT_SIZE * scale * LINE_HEIGHT;
        continue;
      }

      const glyph = this.getGlyph(character);
      if (glyph) {
        this.markDrawn(glyph);
        glyphs.push(glyph);
      } else {
        measured = false;
      }
    }
    if (!measured) {
      return {byteSize: 0, drawables: []};
    }
    // TODO(april): no idea why this is negative...
    yHeight -= FONT_SIZE * scale;

    PLACEMENTS.length = 0;
    let yOffset = yHeight / 2;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const dy = anchor ? this.anchorShift(graphemes, scale, yOffset, anchor, LINE_SHIFTS) : 0;
    let line = 0;
    let lineStart = 0;
    let first = 0;
    for (let i = 0; i <= graphemes.length; ++i) {
      if (i < graphemes.length && graphemes[i] !== '\n') {
        continue;
      }

      const dx = anchor ? LINE_SHIFTS[line] : 0;
      const last = first + i - lineStart;
      let width = 0;
      for (let j = first; j < last; ++j) {
        width += glyphs[j].glyphAdvance * scale;
      }
      let x = offsetPx[0] + dx * cos - (dy + yOffset) * sin - width / 2 * cos;
      let y = offsetPx[1] + dx * sin + (dy + yOffset) * cos - width / 2 * sin;
      for (let j = first; j < last; ++j) {
        const glyph = glyphs[j];
        PLACEMENTS.push(
            x - glyph.glyphTop * scale * sin, y + glyph.glyphTop * scale * cos, angle);
        const advance = glyph.glyphAdvance * scale;
        x += cos * advance;
        y += sin * advance;
      }

      first = last;
      lineStart = i + 1;
      yOffset -= FONT_SIZE * scale * LINE_HEIGHT;
      line += 1;
    }

    return this.planPlaced(
        glyphs,
        center,
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
    if (!this.layOutCurved(graphemes, path, pixelsPerWorld, scale, PLACED_GLYPHS, PLACEMENTS)
        || turnsTooSharply(PLACEMENTS)) {
      return {byteSize: 0, drawables: []};
    }
    return this.planPlaced(
        PLACED_GLYPHS,
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
    let measured = true;
    let widthPx = 0;
    for (const character of graphemes) {
      if (character === '\n') {
        continue;
      }

      const glyph = this.getGlyph(character);
      if (glyph) {
        glyphs.push(glyph);
        widthPx += glyph.glyphAdvance * scale;
      } else {
        measured = false;
      }
    }
    if (!measured) {
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
    let ready = true;
    for (const glyph of glyphs) {
      ready = this.markDrawn(glyph as AtlasGlyph) && ready;
    }
    if (!ready) {
      return {byteSize: 0, drawables: []};
    }

    if (this.atlasUploads.get(renderer) !== this.atlasVersion) {
      renderer.uploadAlphaTexture(
          this.atlas, [ATLAS_WIDTH, ATLAS_HEIGHT], renderer.sdfProgram.atlas);
      this.atlasUploads.set(renderer, this.atlasVersion);
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
            buffer,
            offset,
            glBuffer);
    return {byteSize, drawables: [drawable]};
  }

  // Gets a unit's metrics, or asks for them and returns undefined if it hasn't been measured.
  private getGlyph(text: string): AtlasGlyph|undefined {
    const glyph = this.glyphs.get(text);
    if (!glyph) {
      this.unmeasured.add(text);
      this.scheduleRegeneration();
    }
    return glyph;
  }

  // Records that a label is drawing glyph and returns whether it is in the atlas, asking for it if
  // not. Every unit of a label is marked even when an earlier one is missing, so eviction keeps the
  // rest of a label that is waiting on one word.
  private markDrawn(glyph: AtlasGlyph): boolean {
    glyph.drawnIn = this.generation;
    if (glyph.placed) {
      return true;
    }
    if (!glyph.unplaceable) {
      this.wanted.add(glyph.text);
      this.scheduleRegeneration();
    }
    return false;
  }

  // Each label missing a glyph asks, and one regeneration covers them all.
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
      const families = FONT_FAMILIES.map(f => `family=${f.replace(/ /g, '+')}`).join('&');
      fetch(`https://fonts.googleapis.com/css2?${families}`)
          .then(response => response.text())
          .then(text => {
            for (const face of parseCss(text)) {
              const priority = FONT_FAMILIES.indexOf(face.family);
              for (const [start, end] of face.ranges) {
                this.fonts.push([start, end, face, priority]);
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
    for (const unit of this.unmeasured) {
      for (const code of Array.from(unit)) {
        const codepoint = code.codePointAt(0) ?? 0;
        if (codepoint === 0x200D) {
          // Zero width joiner
          continue;
        } else if (codepoint === 0xFE0E || codepoint === 0xFE0F) {
          // Variational selector
          continue;
        }

        const font = this.getFont(codepoint);
        if (font && !font.loaded) {
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

    if (missing) {
      return;
    }

    for (const unit of this.unmeasured) {
      this.glyphs.set(unit, this.measure(unit));
    }
    this.unmeasured.clear();

    let drew = false;
    let evicted = false;
    for (const unit of this.wanted) {
      const glyph = checkExists(this.glyphs.get(unit));
      if (glyph.placed || glyph.unplaceable) {
        continue;
      }
      if (!this.place(glyph)) {
        if (!evicted) {
          this.evict();
          evicted = true;
        }
        if (!this.place(glyph)) {
          glyph.unplaceable = true;
          if (!this.overflowed) {
            console.warn('Glyph atlas is full, so some labels will be missing');
            this.overflowed = true;
          }
          continue;
        }
      }
      drew = true;
    }
    this.wanted.clear();

    if (drew || evicted) {
      this.atlasVersion += 1;
    }
    this.generation += 1;
    for (const listener of this.listeners) {
      listener();
    }
  }

  // Gets a unit's metrics without drawing it, so a label can be measured and placed before it costs
  // any atlas space. Keep in sync with TinySDF#draw, which computes the same metrics as it draws.
  private measure(text: string): AtlasGlyph {
    const sdf = this.tinySdf as unknown as TinySdfInternals;
    const metrics = sdf.ctx.measureText(text);
    const glyphTop = Math.ceil(metrics.actualBoundingBoxAscent);
    const glyphLeft = Math.floor(-metrics.actualBoundingBoxLeft);
    const glyphWidth = Math.max(0, Math.ceil(metrics.actualBoundingBoxRight) - glyphLeft);
    // place copies the ink no further down than this, see the TODO there.
    const glyphHeight =
        Math.max(
            0,
            Math.min(
                ATLAS_ROW_HEIGHT - ATLAS_INSET - sdf.buffer,
                glyphTop + Math.ceil(metrics.actualBoundingBoxDescent)));
    const bitmapWidth = glyphWidth + 2 * sdf.buffer;
    // An even width keeps the cell a whole number of FONT_SIZE pixels.
    const cellWidth = Math.max(ATLAS_ROW_HEIGHT, 2 * Math.ceil((ATLAS_INSET + bitmapWidth) / 2));
    return {
      atlasX: 0,
      atlasY: 0,
      atlasWidth: cellWidth,
      atlasHeight: ATLAS_ROW_HEIGHT,
      glyphAdvance: metrics.width / SDF_SCALE,
      glyphWidth: glyphWidth / SDF_SCALE,
      glyphHeight: glyphHeight / SDF_SCALE,
      glyphTop: glyphTop / SDF_SCALE,
      width: cellWidth / SDF_SCALE,
      height: ATLAS_GLYPH_SIZE,
      text,
      placed: false,
      drawnIn: -1,
      unplaceable: false,
    };
  }

  // Draws glyph into the next free cell, or returns false if the atlas has no room left. Cells fill
  // rows left to right.
  private place(glyph: AtlasGlyph): boolean {
    if (this.cursorX + glyph.atlasWidth > ATLAS_WIDTH) {
      this.cursorX = 0;
      this.cursorY += ATLAS_ROW_HEIGHT;
    }
    if (this.cursorY + ATLAS_ROW_HEIGHT > ATLAS_HEIGHT) {
      return false;
    }

    const g = this.drawUnit(glyph.text);
    // TODO(april): units taller than a row lose the bottom of their halo, but taller rows would
    // cost atlas capacity for every glyph.
    copyIntoImage(
        g.data,
        g.width,
        Math.min(g.height, ATLAS_ROW_HEIGHT - ATLAS_INSET),
        this.atlas,
        this.cursorX + ATLAS_INSET,
        this.cursorY + ATLAS_INSET,
        ATLAS_WIDTH);
    glyph.atlasX = this.cursorX;
    glyph.atlasY = this.cursorY;
    glyph.placed = true;
    this.cursorX += glyph.atlasWidth;
    return true;
  }

  // Empties the atlas and draws back only the glyphs drawn since the last regeneration, which is
  // what is on screen.
  private evict(): void {
    this.evictions += 1;
    this.atlas.fill(0);
    this.cursorX = 0;
    this.cursorY = 0;
    const kept = [];
    for (const glyph of this.glyphs.values()) {
      glyph.unplaceable = false;
      if (glyph.placed && glyph.drawnIn === this.generation) {
        kept.push(glyph);
      }
      glyph.placed = false;
    }
    // What was on screen can outgrow even an empty atlas, and asking for the rest every frame would
    // evict every frame.
    for (const glyph of kept) {
      if (!this.place(glyph)) {
        glyph.unplaceable = true;
      }
    }
  }

  // The face the canvas will draw codepoint with, which is in the first family whose
  // unicode-range has it.
  private getFont(codepoint: number): LoadAwareFontFace|undefined {
    let best;
    let bestPriority = Infinity;
    for (const [start, end, font, priority] of this.fonts) {
      if (codepoint >= end) {
        continue;
      }
      if (codepoint < start) {
        break;
      }
      if (priority < bestPriority) {
        best = font;
        bestPriority = priority;
      }
    }
    return best;
  }

  // Draws a unit, first growing tinySdf's canvas and scratch grids if its ink is bigger than any
  // before it, because TinySDF sizes them for one em and clamps ink to that. TinySDF's output
  // depends only on the ink, so growing leaves smaller units drawn the same. Resizing a canvas
  // resets its context, so we restore what TinySDF set.
  private drawUnit(text: string): ReturnType<TinySDF['draw']> {
    const sdf = this.tinySdf as unknown as TinySdfInternals;
    const metrics = sdf.ctx.measureText(text);
    // at least TinySDF's glyphWidth and glyphHeight, which ceil each side separately
    const inkWidth =
        Math.ceil(metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight) + 1;
    const inkHeight =
        Math.ceil(metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent) + 1;
    if (inkWidth > this.sdfWidth || inkHeight > this.sdfHeight) {
      // Half again so a run of slightly longer words doesn't regrow every time.
      this.sdfWidth = Math.max(this.sdfWidth, Math.ceil(inkWidth * 1.5));
      this.sdfHeight = Math.max(this.sdfHeight, Math.ceil(inkHeight * 1.5));
      const width = this.sdfWidth + 2 * sdf.buffer;
      const height = this.sdfHeight + 2 * sdf.buffer;

      const ctx = sdf.ctx;
      const font = ctx.font;
      ctx.canvas.width = width;
      ctx.canvas.height = height;
      ctx.font = font;
      ctx.textBaseline = 'alphabetic';
      ctx.textAlign = 'left';
      ctx.fillStyle = 'black';

      sdf.maxGlyphDim = Math.max(this.sdfWidth, this.sdfHeight);
      sdf.gridOuter = new Float64Array(width * height);
      sdf.gridInner = new Float64Array(width * height);
      const gridLength = Math.max(width, height);
      sdf.f = new Float64Array(gridLength);
      sdf.z = new Float64Array(gridLength + 1);
      sdf.v = new Uint16Array(gridLength);
    }
    return this.tinySdf.draw(text);
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

export function turnsTooSharply(placements: number[]): boolean {
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
    rows: number,
    image: Uint8Array,
    dx: number,
    dy: number,
    dwidth: number): void {
  for (let y = 0; y < rows; ++y) {
    image.set(data.subarray(y * swidth, (y + 1) * swidth), (dy + y) * dwidth + dx);
  }
}

export function toGraphemes(text: string): string[] {
  return Array.from(SEGMENTER.segment(text), s => s.segment);
}

/** Returns how far a label's halo reaches past its ink, in pixels, at the scale. */
export function getHaloPx(scale: number): number {
  // TinySDF's value falls by 1 every SDF_RADIUS_PX FONT_SIZE pixels away from the glyph.
  return (INK_EDGE - HALO_EDGE) * SDF_RADIUS_PX * scale;
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
