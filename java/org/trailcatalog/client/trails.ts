import { decodeBase64 } from './common/base64';
import { latLngFromBase64E7 } from './common/data';
import { LittleEndianView } from './common/little_endian_view';
import { degreesE7ToLatLng, projectLatLng } from './common/math';
import { emptyS2Polygon, LatLng, LatLngRect } from './common/types';
import { Boundary, ElevationProfile, Trail } from './models/types';

import { DataResponses } from './data';

export function containingBoundariesFromRaw(
    raw: DataResponses['boundaries_containing_trail']): Boundary[] {
  return raw.boundaries.map(
      b =>
          new Boundary(
              BigInt(b.id),
              b.name,
              b.type,
              emptyS2Polygon()));
}

export function pathProfilesInTrailFromRaw(
    raw: DataResponses['path_profiles_in_trail']): Map<bigint, ElevationProfile> {
  return new Map(raw.profiles.map(
      p => {
        const points = [];
        const samples = [];
        const sampleStream = new LittleEndianView(decodeBase64(p.samples_meters));
        while (sampleStream.hasRemaining()) {
          points.push([
            sampleStream.getInt32() / 10_000_000,
            sampleStream.getInt32() / 10_000_000,
          ] as LatLng);
          samples.push(sampleStream.getFloat32());
        }

        return [
          BigInt(p.id),
          new ElevationProfile(points, samples),
        ];
      }));
}

export function trailFromRaw(raw: DataResponses['trail']): Trail {
  const paths = [];
  const pathBuffer = decodeBase64(raw.path_ids);
  const pathStream = new LittleEndianView(pathBuffer);
  for (let i = 0; i < pathBuffer.byteLength; i += 8) {
    paths.push(pathStream.getBigInt64());
  }
  const boundStream = new LittleEndianView(decodeBase64(raw.bound));
  const bound = {
    low: [boundStream.getInt32() / 10_000_000, boundStream.getInt32() / 10_000_000],
    high: [boundStream.getInt32() / 10_000_000, boundStream.getInt32() / 10_000_000],
    brand: 'LatLngRect' as const,
  } as LatLngRect;
  const marker = latLngFromBase64E7(raw.marker);
  return new Trail(
      BigInt(raw.id),
      raw.name,
      raw.type,
      {low: [0, 0], high: [0, 0], brand: 'PixelRect' as const},
      paths,
      bound,
      marker,
      projectLatLng(marker),
      raw.elevation_down_meters,
      raw.elevation_up_meters,
      raw.length_meters);
}

