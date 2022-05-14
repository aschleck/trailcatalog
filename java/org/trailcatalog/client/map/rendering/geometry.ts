import { Vec4 } from '../../common/types';

export interface Line {
  colorFill: Vec4;
  colorStroke: Vec4;
  vertices: Float32Array|Float64Array;
}

