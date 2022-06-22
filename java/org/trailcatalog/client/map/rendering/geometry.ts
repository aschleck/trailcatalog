import { Rgba32F } from '../../common/types';

export interface Line {
  colorFill: Rgba32F;
  colorStroke: Rgba32F;
  vertices: Float32Array|Float64Array;
}

