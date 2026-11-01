// https://www.rfc-editor.org/rfc/rfc1321
//
// Web Crypto has no MD5, and Commons shards its files by the MD5 of their names.

const SHIFTS = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];

// The fractional parts are at least 0.015 from an integer, so the rounding of Math.sin can't
// change them.
const SINES =
    Array.from({length: 64}, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32));

/** Returns the MD5 of text's UTF-8 bytes in lowercase hex. */
export function md5(text: string): string {
  const bytes = new TextEncoder().encode(text);
  // The message, a 0x80 byte, and a 64 bit length, padded to a whole number of 64 byte blocks
  const words = new Uint32Array((((bytes.length + 8) >>> 6) + 1) * 16);
  for (let i = 0; i < bytes.length; ++i) {
    words[i >>> 2] |= bytes[i] << ((i % 4) * 8);
  }
  words[bytes.length >>> 2] |= 0x80 << ((bytes.length % 4) * 8);
  // We skip the high word because nothing we hash is 512 MB.
  words[words.length - 2] = bytes.length * 8;

  const state = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476];
  for (let block = 0; block < words.length; block += 16) {
    let [a, b, c, d] = state;
    for (let i = 0; i < 64; ++i) {
      let f;
      let g;
      if (i < 16) {
        f = (b & c) | (~b & d);
        g = i;
      } else if (i < 32) {
        f = (d & b) | (~d & c);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        f = b ^ c ^ d;
        g = (3 * i + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = (7 * i) % 16;
      }
      const sum = (a + f + SINES[i] + words[block + g]) | 0;
      const shift = SHIFTS[(i >>> 4) * 4 + i % 4];
      a = d;
      d = c;
      c = b;
      b = (b + ((sum << shift) | (sum >>> (32 - shift)))) | 0;
    }
    state[0] = (state[0] + a) | 0;
    state[1] = (state[1] + b) | 0;
    state[2] = (state[2] + c) | 0;
    state[3] = (state[3] + d) | 0;
  }

  let hex = '';
  for (const word of state) {
    for (let i = 0; i < 4; ++i) {
      hex += ((word >>> (i * 8)) & 0xff).toString(16).padStart(2, '0');
    }
  }
  return hex;
}
