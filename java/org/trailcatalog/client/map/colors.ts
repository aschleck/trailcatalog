import { rgbaU32ToHex, rgbaToUint32 } from 'js/map/common/math';
import { RgbaU32 } from 'js/map/common/types';

export interface LinePalette {
  hex: {
    fill: string;
    stroke: string;
  };
  raw: {
    fill: RgbaU32;
    stroke: RgbaU32;
  };
}

export const ACTIVE_PALETTE =
    paletteFromFillStroke(rgbaToUint32(1, 0.902, 0, 1), rgbaToUint32(0, 0, 0, 1));

export const BOUNDARY_PALETTE = {
  fill: rgbaToUint32(1, 0.902, 0, 1),
  stroke: rgbaToUint32(0, 0, 0, 1),
} as const;
export const BOUNDARY_HEX_PALETTE = {
  fill: rgbaU32ToHex(BOUNDARY_PALETTE.fill),
  stroke: rgbaU32ToHex(BOUNDARY_PALETTE.stroke),
} as const;

export const DEFAULT_PALETTE = {
  fill: rgbaToUint32(0, 0, 0, 1),
  stroke: rgbaToUint32(1, 1, 1, 1),
} as const;
export const DEFAULT_HEX_PALETTE = {
  fill: rgbaU32ToHex(DEFAULT_PALETTE.fill),
  stroke: rgbaU32ToHex(DEFAULT_PALETTE.stroke),
} as const;

export const ERROR_PALETTE =
    paletteFromFillStroke(rgbaToUint32(0.965, 0.584, 0.584, 1), rgbaToUint32(0, 0, 0, 1));

export const HOVER_PALETTE =
    paletteFromFillStroke(rgbaToUint32(1, 1, 1, 1), rgbaToUint32(0, 0, 0, 1));

function paletteFromFillStroke(fill: RgbaU32, stroke: RgbaU32): LinePalette {
  return {
    hex: {
      fill: rgbaU32ToHex(fill),
      stroke: rgbaU32ToHex(stroke),
    },
    raw: {
      fill,
      stroke,
    },
  };
}
