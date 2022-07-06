// This and following based on https://developer.mozilla.org/en-US/docs/Glossary/Base64
export function decodeBase64(base64: string): ArrayBuffer {
  const nInLen = base64.replace(/=+/, '').length;
  const nOutLen = nInLen / 4 * 3;
  const taBytes = new Uint8Array(nOutLen);

  for (let nMod3, nMod4, nUint24 = 0, nOutIdx = 0, nInIdx = 0; nInIdx < nInLen; nInIdx++) {
    nMod4 = nInIdx & 3;
    nUint24 |= b64ToUint6(base64.charCodeAt(nInIdx)) << 6 * (3 - nMod4);
    if (nMod4 === 3 || nInLen - nInIdx === 1) {
      for (nMod3 = 0; nMod3 < 3 && nOutIdx < nOutLen; nMod3++, nOutIdx++) {
        taBytes[nOutIdx] = nUint24 >>> (16 >>> nMod3 & 24) & 255;
      }
      nUint24 = 0;
    }
  }

  return taBytes.buffer;
}

export function b64ToUint6(nChr: number): number {
  return nChr > 64 && nChr < 91 ?
          nChr - 65
      : nChr > 96 && nChr < 123 ?
          nChr - 71
      : nChr > 47 && nChr < 58 ?
          nChr + 4
      : nChr === 43 ?
          62
      : nChr === 47 ?
          63
      :
          0;
}
