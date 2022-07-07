import { rgba32FToHex, rgbaToUint32F } from '../../common/math';

export const ACTIVE_PALETTE = {
  fill: rgbaToUint32F(1, 0.901, 0, 1),
  stroke: rgbaToUint32F(0, 0, 0, 1),
} as const;
export const ACTIVE_HEX_PALETTE = {
  fill: rgba32FToHex(ACTIVE_PALETTE.fill),
  stroke: rgba32FToHex(ACTIVE_PALETTE.stroke),
} as const;

export const BOUNDARY_PALETTE = {
  fill: rgbaToUint32F(1, 0, 0, 1),
  stroke: rgbaToUint32F(0, 0, 0, 1),
} as const;
export const BOUNDARY_HEX_PALETTE = {
  fill: rgba32FToHex(BOUNDARY_PALETTE.fill),
  stroke: rgba32FToHex(BOUNDARY_PALETTE.stroke),
} as const;

export const DEFAULT_PALETTE = {
  fill: rgbaToUint32F(0, 0, 0, 1),
  stroke: rgbaToUint32F(1, 1, 1, 1),
} as const;
export const DEFAULT_HEX_PALETTE = {
  fill: rgba32FToHex(DEFAULT_PALETTE.fill),
  stroke: rgba32FToHex(DEFAULT_PALETTE.stroke),
} as const;

export const HOVER_PALETTE = {
  fill: rgbaToUint32F(1, 1, 1, 1),
  stroke: rgbaToUint32F(0, 0, 0, 1),
} as const;
export const HOVER_HEX_PALETTE = {
  fill: rgba32FToHex(HOVER_PALETTE.fill),
  stroke: rgba32FToHex(HOVER_PALETTE.stroke),
} as const;

