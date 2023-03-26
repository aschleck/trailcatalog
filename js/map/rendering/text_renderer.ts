import TinySDF from '@mapbox/tiny-sdf';
import { checkArgument, checkExists } from 'js/common/asserts';
import { HashMap, HashSet } from 'js/common/collections';
import { Debouncer } from 'js/common/debouncer';

import { RgbaU32, Vec2 } from '../common/types';

import { RenderPlanner } from './render_planner';
import { Renderer } from './renderer';
import { Glyph } from './sdf_program';
import { TexturePool } from './texture_pool';

const FONT_SIZE = 14;
const ATLAS_GLYPH_SIZE = FONT_SIZE + 2 * Math.ceil(FONT_SIZE / 8);

export class TextRenderer {

  private readonly atlas: WebGLTexture;
  private readonly characters: Set<string>;
  private readonly font: Promise<FontFace>;
  private readonly glyphs: Map<String, Glyph>;
  private readonly regenerator: Debouncer;
  private tinySdf: TinySDF;

  constructor(private readonly renderer: Renderer) {
    this.atlas = this.renderer.createTexture();
    this.characters = new Set();
    this.font =
        new FontFace(
                'Roboto',
                "url(https://fonts.gstatic.com/s/roboto/v30/KFOlCnqEu92Fr1MmEU9fBBc4AMP6lQ.woff2) "
                    + "format('woff2')")
            .load();
    this.glyphs = new Map();
    this.regenerator = new Debouncer(0, () => { this.regenerate(); });
    this.tinySdf = new TinySDF({fontSize: FONT_SIZE, fontFamily: 'Roboto'});

    this.characters.add('e');
    for (let i = 32; i < 127; ++i) {
      this.characters.add(String.fromCharCode(i));
    }

    this.font.then(font => {
      document.fonts.add(font);
      this.regenerate();
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
      planner: RenderPlanner): Vec2 {
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

    offset[0] += -size[0] / 2;
    offset[1] += -size[1] / 2;

    if (valid) {
      planner.addGlyphs(glyphs, fill, stroke, scale, center, offset, this.atlas, ATLAS_GLYPH_SIZE);
      return size;
    } else {
      this.regenerator.trigger();
      return [0, 0];
    }
  }

  private regenerate(): void {
    this.glyphs.clear();
    this.tinySdf = new TinySDF({
      fontSize: FONT_SIZE,
      fontFamily: 'Roboto',
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
        const g = this.tinySdf.draw(character);
        copyIntoImage(g.data, g.width, atlas, x, y, atlasWidth);
        this.glyphs.set(character, {
          index: i,
          glyphAdvance: g.glyphAdvance,
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
