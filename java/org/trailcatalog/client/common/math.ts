import { Long } from 'java/org/trailcatalog/s2';

import { LatLng, Vec2, Vec4 } from './types';

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

const reinterpretIntBuffer = new ArrayBuffer(4);
const reinterpretLongBuffer = new ArrayBuffer(8);

/** Reads a float using the bits of a Closure Long. */
export function reinterpretLong(v: Long): number {
  const floats = new Int32Array(reinterpretLongBuffer);
  floats[0] = v.getHighBits();
  floats[1] = v.getLowBits();
  return new Float64Array(reinterpretLongBuffer)[0];
}

/**
 * Converts an rgba color in the range [0, 1] to an int, and then casts the int's bits to float.
 */
export function rgbaToUint32F(r: number, g: number, b: number, a: number): number {
  const v = ((255 * r) << 24) | ((255 * g) << 16) | ((255 * b) << 8) | (255 * a);
  const ints = new Int32Array(reinterpretIntBuffer);
  ints[0] = v;
  return new Float32Array(reinterpretIntBuffer)[0];
}

export function splitVec2(v: Vec2): Vec4 {
  const x = v[0];
  const xF = Math.fround(x);
  const y = v[1];
  const yF = Math.fround(y);
  return [xF, x - xF, yF, y - yF];
}

