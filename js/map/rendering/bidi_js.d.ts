declare module 'bidi-js' {
  interface EmbeddingLevels {
    levels: Uint8Array;
    paragraphs: Array<{start: number; end: number; level: number}>;
  }

  interface Bidi {
    getEmbeddingLevels(text: string, direction?: 'ltr'|'rtl'): EmbeddingLevels;
    getMirroredCharactersMap(
        text: string, levels: Uint8Array, start?: number, end?: number): Map<number, string>;
  }

  export default function bidiFactory(): Bidi;
}
