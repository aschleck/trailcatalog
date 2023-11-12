import TinySDF from '@mapbox/tiny-sdf';
import GraphemeSplitter from 'grapheme-splitter';

import { checkExists } from 'js/common/asserts';
import { FontFace, parseCss } from 'js/common/css';
import { Debouncer } from 'js/common/debouncer';

import { RgbaU32, Vec2 } from '../common/types';

import { Drawable } from './program';
import { Renderer } from './renderer';
import { Glyph } from './sdf_program';
import { TexturePool } from './texture_pool';

interface LoadAwareFontFace extends FontFace {
  loaded?: boolean;
}

const FONT_SIZE = 28;
const LINE_HEIGHT = 1.6;
const ATLAS_GLYPH_SIZE = 32;

const ATLAS_WIDTH = 2048;
const ATLAS_HEIGHT = 2048;
const SPLITTER = new GraphemeSplitter();

class Glypher {

  private readonly atlas: Uint8Array;
  private readonly atlasUploads: WeakMap<Renderer, number>;
  private readonly characters: Set<string>;
  private readonly fonts: Array<[start: number, end: number, font: LoadAwareFontFace]>;
  private readonly glyphs: Map<String, Glyph>;
  private readonly regenerator: Debouncer;
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

    for (let i = 32; i < 127; ++i) {
      this.characters.add(String.fromCodePoint(i));
    }
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
    if (this.generation < 0) {
      this.regenerate();
    }

    let regenerate = false;
    let lineHeight = 0;
    let yHeight = 0;
    for (const character of graphemes) {
      if (character === '\n') {
        yHeight += lineHeight;
        lineHeight = 0;
        continue;
      }

      const glyph = this.glyphs.get(character);
      if (glyph) {
        lineHeight = Math.max(lineHeight, glyph.glyphHeight * scale);
      } else {
        this.characters.add(character);
        regenerate = true;
      }
    }
    yHeight += lineHeight;

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
    let yOffset = 0;
    for (let i = 0; i < graphemes.length; ++i) {
      const character = graphemes[i];
      if (character !== '\n') {
        const glyph = checkExists(this.glyphs.get(character));
        lineHeight = Math.max(lineHeight, glyph.glyphHeight * scale);
        pending.push(glyph);
      }

      if (i === graphemes.length - 1 || character === '\n') {
        const {byteSize, drawable} = renderer.sdfProgram.plan(
            pending,
            center,
            [offsetPx[0], offsetPx[1] - yHeight / 2 + yOffset],
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
        yOffset -= lineHeight * LINE_HEIGHT;
        lineHeight = 0;
      }
    }

    return {
      byteSize: totalByteSize,
      drawables,
    };
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

      // We don't bail out because we likely have at least sans-serif. Better to draw something
      // than nothing.
    }

    const tinySdf = new TinySDF({
      fontSize: FONT_SIZE,
      fontFamily: 'Roboto,"Noto Emoji",sans-serif',
      fontStyle: 'normal',
      fontWeight: '400',
    });

    const size = ATLAS_GLYPH_SIZE;

    let i = 0;
    this.glyphs.clear();
    for (const character of this.characters) {
      const codepoint = character.codePointAt(0) ?? 0;
      for (const [start, end, font] of this.fonts) {
        if (codepoint < start) {
          continue;
        }

        if (codepoint >= end) {
          break;
        }

        if (!font.loaded) {
          new FontFace(font.family, font.src).load().then(() => { this.regenerator.trigger(); });
          font.loaded = true;
        }
      }

      const x = i % (ATLAS_WIDTH / size) * size;
      const y = Math.floor(i / (ATLAS_WIDTH / size)) * size;
      const g = tinySdf.draw(character);
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
