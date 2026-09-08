/** Returns a buffer holding at least the given bytes, reusing the one passed in when it fits. */
export function growBuffer(buffer: ArrayBuffer, needed: number): ArrayBuffer {
  if (needed <= buffer.byteLength) {
    return buffer;
  }
  const capacity = Math.pow(2, Math.ceil(Math.log2(needed)) + 1);
  return new ArrayBuffer(capacity);
}
