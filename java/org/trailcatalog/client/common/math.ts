import { Long } from 'java/org/trailcatalog/s2';

import { LatLng, RgbaU32, Vec2, Vec4 } from './types';

export function metersToMiles(meters: number): number {
  return meters * 0.00062137119224;
}

export function degreesE7ToLatLng(lat: number, lng: number): LatLng {
  return [
    lat / 10_000_000,
    lng / 10_000_000,
  ] as LatLng;
}

export function projectLatLng(latLng: LatLng): Vec2 {
  const radians = [latLng[0] / 180 * Math.PI, latLng[1] / 180 * Math.PI];
  const x = radians[1] / Math.PI;
  const y = Math.log((1 + Math.sin(radians[0])) / (1 - Math.sin(radians[0]))) / (2 * Math.PI);
  return [x, y];
}

const reinterpretLongBuffer = new ArrayBuffer(8);
const reinterpretFloatArray = new Float64Array(reinterpretLongBuffer);
const reinterpretIntArray = new Int32Array(reinterpretLongBuffer);

/** Reads a float using the bits of a Closure Long. */
export function reinterpretLong(v: Long): number {
  reinterpretIntArray[0] = v.getHighBits();
  reinterpretIntArray[1] = v.getLowBits();
  return reinterpretFloatArray[0];
}

/**
 * Converts an rgba color in the range [0, 1] to an int.
 */
export function rgbaToUint32(r: number, g: number, b: number, a: number): RgbaU32 {
  return (((255 * r) << 24) | ((255 * g) << 16) | ((255 * b) << 8) | (255 * a)) as RgbaU32;
}

export function rgbaU32ToHex(color: RgbaU32): string {
  const r = ((color >> 24) & 0xff).toString(16).padStart(2, '0');
  const g = ((color >> 16) & 0xff).toString(16).padStart(2, '0');
  const b = ((color >> 8) & 0xff).toString(16).padStart(2, '0');
  const a = (color & 0xff).toString(16).padStart(2, '0');
  return `#${r}${g}${b}${a}`;
}

export function splitVec2(v: Vec2): Vec4 {
  const x = v[0];
  const xF = Math.fround(x);
  const y = v[1];
  const yF = Math.fround(y);
  return [xF, x - xF, yF, y - yF];
}

