import { Long } from 'java/org/trailcatalog/s2';

const reinterpretLongBuffer = new ArrayBuffer(8);

/** Reads a float using the bits of a Closure Long. */
export function reinterpretLong(v: Long): number {
  const floats = new Int32Array(reinterpretLongBuffer);
  floats[0] = v.getHighBits();
  floats[1] = v.getLowBits();
  return new Float64Array(reinterpretLongBuffer)[0];
}
