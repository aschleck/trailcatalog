import { RgbaU32 } from '../../common/types';

// TODO(april): do we want this?
// export interface Billboard {
//   atlasIndex: number;
//   atlasSize: Vec2;
//   center: Vec2;
//   colorTint: RgbaU32;
//   offset: Vec2;
//   size: Vec2;
//   texture: WebGLTexture;
//   z: number;
// }

export interface Line {
  colorFill: RgbaU32;
  colorStroke: RgbaU32;
  stipple: boolean;
  vertices: Float32Array|Float64Array;
}

