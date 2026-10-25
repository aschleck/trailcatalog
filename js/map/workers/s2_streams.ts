import { S2CellToken } from '../common/types';

// One slice of a collection. A stream carries the objects whose own cell sits in [fromLevel,
// toLevel], which are the objects about the size of those cells, and tiles them at indexBottom.
// Streams split the levels between them so no object is in two of them and no two tiles ever draw
// the same object.
export interface Stream {
  // Half open, matching the bands in the line styles. Keep streams that overlap in level disjoint
  // in zoom, or else both tile the same objects and each cell draws them once.
  minZoom: number;
  maxZoom: number|undefined;
  indexBottom: number;
  fromLevel: number;
  toLevel: number|undefined;
  // The only categories the server sends, because the style draws nothing else in this band, or
  // undefined for all of them
  categories?: number[];
}

export type CellKey = string & {brand: 'CellKey'};

export function cellKey(stream: number, token: S2CellToken): CellKey {
  return `${stream}/${token}` as CellKey;
}

export function getStream(key: CellKey): number {
  return Number(key.substring(0, key.indexOf('/')));
}

export function isInBand(stream: Stream, zoom: number): boolean {
  return stream.minZoom <= zoom && (stream.maxZoom === undefined || zoom < stream.maxZoom);
}
