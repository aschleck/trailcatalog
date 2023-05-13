import TinySDF from '@mapbox/tiny-sdf';
import { checkArgument, checkExists } from 'js/common/asserts';
import { HashMap, HashSet } from 'js/common/collections';
import { Debouncer } from 'js/common/debouncer';
import { Disposable } from 'js/common/disposable';

import { RgbaU32, Vec2 } from '../common/types';

import { RenderBaker } from './render_baker';
import { Renderer } from './renderer';
import { Glyph } from './sdf_program';
import { TexturePool } from './texture_pool';

const FONT_SIZE = 24;
const LINE_HEIGHT = 1.6;
const ATLAS_GLYPH_SIZE = FONT_SIZE + 2 * Math.ceil(FONT_SIZE / 8);

export class SdfPlanner extends Disposable {

  private readonly atlas: WebGLTexture;
  private readonly characters: Set<string>;
  private readonly glyphs: Map<String, Glyph>;
  private readonly regenerator: Debouncer;

  constructor(
      private readonly fontStyle: 'italic'|'normal',
      private readonly renderer: Renderer) {
    super();
    this.atlas = this.renderer.createTexture();
    this.registerDisposer(() => {
      this.renderer.deleteTexture(this.atlas);
    });

    this.characters = new Set();
    this.glyphs = new Map();
    this.regenerator = new Debouncer(0, () => { this.regenerate(); });

    this.characters.add('e');
    for (let i = 32; i < 127; ++i) {
      this.characters.add(String.fromCharCode(i));
    }

    new FontFace(
            'Roboto',
            "url(https://fonts.gstatic.com/s/roboto/v30/KFOkCnqEu92Fr1Mu51xIIzIXKMny.woff2) "
                + "format('woff2')")
        .load()
        .then(font => {
          this.regenerator.trigger();
        });
  }

  measure(characters: string, scale: number): Vec2 {
    let valid = true;
    const glyphs = [];
    const size: Vec2 = [0, 0];
    for (const c of characters) {
      const glyph = this.glyphs.get(c);
      if (glyph) {
        glyphs.push(glyph);
        size[0] += glyph.glyphAdvance * scale;
        size[1] = Math.max(size[1], glyph.glyphHeight * scale);
      } else {
        this.characters.add(c);
        valid = false;
      }
    }

    if (valid) {
      return size;
    } else {
      this.regenerator.trigger();
      return [0, 0];
    }
  }

  plan(
      characters: string,
      fill: RgbaU32,
      stroke: RgbaU32,
      scale: number,
      center: Vec2,
      offset: Vec2,
      angle: number,
      z: number,
      baker: RenderBaker): void {
    let valid = true;
    for (const c of characters) {
      if (c === '\n') {
        continue;
      }

      if (!this.glyphs.has(c)) {
        this.characters.add(c);
        valid = false;
      }
    }

    if (!valid) {
      this.regenerator.trigger();
      return;
    }

    const lines = characters.split('\n');
    let previousLinesHeight = 0;
    for (let i = lines.length - 1; i >= 0; --i) {
      const line = lines[i];
      const glyphs = [];
      const size: Vec2 = [0, 0];
      for (const c of line) {
        const glyph = checkExists(this.glyphs.get(c));
        glyphs.push(glyph);
        size[0] += glyph.glyphAdvance * scale;
        size[1] = Math.max(size[1], glyph.glyphHeight * scale);
      }

      // I don't understand the advance thing but qualitatively it looks good.
      const lineOffset = [
        offset[0] + -size[0] / 2 - glyphs[glyphs.length - 1].glyphAdvance * scale / 4,
        offset[1] + -size[1] / 2 + previousLinesHeight * LINE_HEIGHT,
      ] as Vec2;
      previousLinesHeight += size[1];

      baker.addGlyphs(
          glyphs, fill, stroke, scale, center, lineOffset, angle, this.atlas, ATLAS_GLYPH_SIZE, z);
    }
  }

  private regenerate(): void {
    this.glyphs.clear();
    const tinySdf = new TinySDF({
      fontSize: FONT_SIZE,
      fontFamily: 'Roboto,sans-serif',
      fontStyle: this.fontStyle,
      fontWeight: '500',
    });

    const atlasWidth = 1024;
    const atlasHeight = 1024;
    const atlas = new Uint8Array(atlasWidth * atlasHeight);

    const characters = [...this.characters];
    const t = characters.length;
    let i = 0;
    const size = ATLAS_GLYPH_SIZE;
    for (let y = 0; y + size <= atlasHeight && i < t; y += size) {
      for (let x = 0; x + size <= atlasWidth && i < t; x += size) {
        const character = characters[i];
        const g = tinySdf.draw(character);
        copyIntoImage(g.data, g.width, atlas, x, y, atlasWidth);
        this.glyphs.set(character, {
          index: i,
          glyphAdvance: g.glyphAdvance,
          glyphWidth: g.glyphWidth,
          glyphHeight: g.glyphHeight,
          glyphTop: g.glyphTop,
          x: x / atlasWidth,
          y: y / atlasHeight,
          width: size / atlasWidth,
          height: size / atlasHeight,
        });
        i += 1;
      }
    }
    checkArgument(i === t, 'Unable to fit glyphs for all characters');

    this.renderer.uploadAlphaTexture(atlas, [atlasWidth, atlasHeight], this.atlas);
  }
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
