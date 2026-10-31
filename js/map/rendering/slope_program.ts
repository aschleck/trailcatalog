import { BillboardProgram } from './billboard_program';

// The texture is terrarium.ts#SLOPES_SIZE to a side, so we map the tile onto the texels inside its
// frame of neighbor pixels.
//
// Each band is 27 to 30, 30 to 35, 35 to 40, 40 to 45, and over 45 degrees, premultiplied.
const SLOPE_FRAGMENT_SHADER = `#version 300 es
    uniform sampler2D color;
    uniform mediump float flattenFactor;

    in highp vec2 fragColorPosition;
    in mediump vec4 fragColorTint;
    in mediump float fragBehindHorizon;
    out mediump vec4 fragColor;

    const highp float TILE_SIZE = 512.;
    const mediump float ALPHA = 0.45;

    void main() {
      if (flattenFactor < 1.0 && fragBehindHorizon < 0.0) {
        discard;
      }
      highp vec2 texel = (fragColorPosition * TILE_SIZE + 1.) / (TILE_SIZE + 2.);
      mediump float slope = texture(color, texel).r * 90.;
      mediump vec3 band =
          slope < 27. ? vec3(0.) :
          slope < 30. ? vec3(0.96, 0.89, 0.25) :
          slope < 35. ? vec3(0.99, 0.62, 0.12) :
          slope < 40. ? vec3(0.89, 0.18, 0.12) :
          slope < 45. ? vec3(0.62, 0.12, 0.55) :
          vec3(0.28, 0.20, 0.58);
      mediump float alpha = slope < 27. ? 0. : ALPHA * fragColorTint.a;
      fragColor = vec4(band * alpha, alpha);
    }
`;

/** Draws tiles of slope angles from SlopeLoader as avalanche slope bands. */
export class SlopeProgram extends BillboardProgram {
  constructor(gl: WebGL2RenderingContext) {
    super(gl, SLOPE_FRAGMENT_SHADER);
  }
}
