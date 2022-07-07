import { rgbaU32ToHex, rgbaToUint32 } from '../../common/math';

export const ACTIVE_PALETTE = {
  fill: rgbaToUint32(1, 0.901, 0, 1),
  stroke: rgbaToUint32(0, 0, 0, 1),
} as const;
export const ACTIVE_HEX_PALETTE = {
  fill: rgbaU32ToHex(ACTIVE_PALETTE.fill),
  stroke: rgbaU32ToHex(ACTIVE_PALETTE.stroke),
} as const;

export const BOUNDARY_PALETTE = {
  fill: rgbaToUint32(1, 0, 0, 1),
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

export const HOVER_PALETTE = {
  fill: rgbaToUint32(1, 1, 1, 1),
  stroke: rgbaToUint32(0, 0, 0, 1),
} as const;
export const HOVER_HEX_PALETTE = {
  fill: rgbaU32ToHex(HOVER_PALETTE.fill),
  stroke: rgbaU32ToHex(HOVER_PALETTE.stroke),
} as const;

