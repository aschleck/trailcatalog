import TinySDF from '@mapbox/tiny-sdf';
import GraphemeSplitter from 'grapheme-splitter';

import { checkExists } from 'external/dev_april_corgi+/js/common/asserts';
import { TFontFace, parseCss } from 'external/dev_april_corgi+/js/common/css';
import { Debouncer } from 'external/dev_april_corgi+/js/common/debouncer';

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
const ATLAS_GLYPH_SIZE = 32;

const ATLAS_WIDTH = 2048;
const ATLAS_HEIGHT = 2048;
const SPLITTER = new GraphemeSplitter();

// Scratch for planCurved, which runs once per curved label per frame.
const PLACEMENTS: number[] = [];
const CURVED_GLYPHS: Glyph[] = [];

class Glypher {

  private readonly atlas: Uint8Array;
  private readonly atlasUploads: WeakMap<Renderer, number>;
  private readonly characters: Set<string>;
  private readonly fonts: Array<[start: number, end: number, font: LoadAwareFontFace]>;
  private readonly glyphs: Map<String, Glyph>;
  private readonly regenerator: Debouncer;
  private readonly tinySdf: TinySDF;
  private cssFetched: boolean;
  private generation: number;

  constructor() {
    this.atlas = new Uint8Array(ATLAS_WIDTH * ATLAS_HEIGHT);
    this.atlasUploads = new WeakMap();
    this.characters = new Set();
    this.fonts = [];
    this.glyphs = new Map();
    this.regenerator = new Debouncer(0, () => { this.regenerate(); });
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
      this.regenerator.trigger();
      return undefined;
    }

    return [xWidth, yHeight];
  }

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
      renderer: Renderer): {byteSize: number; drawables: Drawable[];} {
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
      this.regenerator.trigger();
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
    for (let i = 0; i < graphemes.length; ++i) {
      const character = graphemes[i];
      if (character !== '\n') {
        const glyph = checkExists(this.glyphs.get(character));
        pending.push(glyph);
      }

      if (i === graphemes.length - 1 || character === '\n') {
        const {byteSize, drawable} = renderer.sdfProgram.plan(
            pending,
            center,
            [offsetPx[0] - yOffset * sin, offsetPx[1] + yOffset * cos],
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

        pending.length = 0;
        yOffset -= FONT_SIZE * scale * LINE_HEIGHT;
      }
    }

    return {
      byteSize: totalByteSize,
      drawables,
    };
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
    const glyphs = CURVED_GLYPHS;
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
      this.regenerator.trigger();
      return {byteSize: 0, drawables: []};
    }

    const points = path.length / 2;
    let length = 0;
    for (let i = 0; i + 1 < points; ++i) {
      length += distance(path, i, i + 1);
    }

    const width = widthPx / pixelsPerWorld;
    if (width > length) {
      return {byteSize: 0, drawables: []};
    }

    if (this.atlasUploads.get(renderer) !== this.generation) {
      renderer.uploadAlphaTexture(
          this.atlas, [ATLAS_WIDTH, ATLAS_HEIGHT], renderer.sdfProgram.atlas);
      this.atlasUploads.set(renderer, this.generation);
    }

    // Lay the text out and then see which way it came out reading. Deciding from the path's two
    // endpoints instead gets it wrong wherever a line doubles back, because the ends point one
    // way while the stretch under the text points the other.
    const placements = PLACEMENTS;
    const heading =
        layOutAlong(glyphs, path, length, width, pixelsPerWorld, scale, true, placements);
    if (heading < 0) {
      layOutAlong(glyphs, path, length, width, pixelsPerWorld, scale, false, placements);
    }

    if (turnsTooSharply(placements)) {
      return {byteSize: 0, drawables: []};
    }

    const {byteSize, drawable} =
        renderer.sdfProgram.planPlaced(
            glyphs,
            // The glyphs hang off the head of the path, so that is the label's anchor.
            [path[0], path[1]],
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
                    this.regenerator.trigger();
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
      copyIntoImage(g.data, g.width, this.atlas, x, y, ATLAS_WIDTH);
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
  for (const glyph of glyphs) {
    while (pen > travelled + segmentLength && segment + 2 < points) {
      travelled += segmentLength;
      segment += 1;
      segmentLength = distance(path, first + segment * step, first + (segment + 1) * step);
    }

    const from = 2 * (first + segment * step);
    const to = 2 * (first + (segment + 1) * step);
    const fraction = segmentLength > 0 ? (pen - travelled) / segmentLength : 0;
    const angle = Math.atan2(path[to + 1] - path[from + 1], path[to + 0] - path[from + 0]);
    // Lifts the glyph off the baseline onto the line itself, matching plan's vertical centering.
    const perpendicular = glyph.glyphTop * scale - FONT_SIZE * scale / 2;
    // Offsets from the anchor rather than absolute positions, because these land in a float
    // buffer and mercator coordinates have no precision left to spare at high zoom.
    placements.push(
        (path[from + 0] + fraction * (path[to + 0] - path[from + 0]) - path[0]) * pixelsPerWorld
            - Math.sin(angle) * perpendicular,
        (path[from + 1] + fraction * (path[to + 1] - path[from + 1]) - path[1]) * pixelsPerWorld
            + Math.cos(angle) * perpendicular,
        angle);

    const advance = glyph.glyphAdvance * scale;
    heading += advance * Math.cos(angle);
    pen += advance / pixelsPerWorld;
  }
  return heading;
}

// Text that bends more than this between two glyphs stops reading as one word following a curve.
// It happens where a line doubles back on itself, which puts the tail of the name on the return
// leg pointing at its own head.
const MAX_GLYPH_TURN = Math.PI / 4;

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
  return SPLITTER.splitGraphemes(text);
}
