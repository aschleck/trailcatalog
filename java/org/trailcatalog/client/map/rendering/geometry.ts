import { RgbaU32 } from '../../common/types';

export interface Line {
  colorFill: RgbaU32;
  colorStroke: RgbaU32;
  vertices: Float32Array|Float64Array;
}

