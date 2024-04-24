import { S2LatLngRect, S2Polygon } from 'java/org/trailcatalog/s2';
import { SimpleS2 } from 'java/org/trailcatalog/s2/SimpleS2';
import { LatLngRect } from 'js/map2/common/types';

// A LatLng is a pair of *degrees*.
export type S2CellNumber = number & {brand: 'S2CellNumber'};

export function s2LatLngRectToTc(rect: S2LatLngRect): LatLngRect {
  const lo = rect.lo();
  const hi = rect.hi();
  return {
    low: [lo.latDegrees(), lo.lngDegrees()],
    high: [hi.latDegrees(), hi.lngDegrees()],
    brand: 'LatLngRect',
  };
}

const EMPTY_POLYGON = 
    SimpleS2.decodePolygon(Uint8Array.from([
      /* compressed= */ 4,
      /* level= */ 1,
      /* numLoops= */ 0,
    ]).buffer);

export function emptyS2Polygon(): S2Polygon {
  return EMPTY_POLYGON;
}
