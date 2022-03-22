import { Long } from 'java/org/trailcatalog/s2';

import { Vec2, Vec4 } from './types';

const reinterpretLongBuffer = new ArrayBuffer(8);

/** Reads a float using the bits of a Closure Long. */
export function reinterpretLong(v: Long): number {
  const floats = new Int32Array(reinterpretLongBuffer);
  floats[0] = v.getHighBits();
  floats[1] = v.getLowBits();
  return new Float64Array(reinterpretLongBuffer)[0];
}

export function splitVec2(v: Vec2): Vec4 {
  const x = v[0];
  const xF = Math.fround(x);
  const y = v[1];
  const yF = Math.fround(y);
  return [xF, x - xF, yF, y - yF];
}

