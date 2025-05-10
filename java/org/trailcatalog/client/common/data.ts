import { LittleEndianView } from 'external/dev_april_corgi+/js/common/little_endian_view';

import { LatLng, LatLngRect } from 'js/map/common/types';

import { decodeBase64 } from './base64';

export function latLngFromBase64E7(bytes: string): LatLng {
  const markerStream = new LittleEndianView(decodeBase64(bytes));
  return [
    markerStream.getInt32() / 10_000_000,
    markerStream.getInt32() / 10_000_000,
  ] as const as LatLng;
}

export function latLngRectFromBase64E7(bytes: string): LatLngRect {
  const boundStream = new LittleEndianView(decodeBase64(bytes));
  return {
    low: [boundStream.getInt32() / 10_000_000, boundStream.getInt32() / 10_000_000],
    high: [boundStream.getInt32() / 10_000_000, boundStream.getInt32() / 10_000_000],
    brand: 'LatLngRect' as const,
  } as LatLngRect;
}
