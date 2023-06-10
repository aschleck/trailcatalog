import { LittleEndianView } from 'js/common/little_endian_view';
import { LatLng, LatLngRect } from 'js/map/common/types';

import { decodeBase64 } from './common/base64';
import { latLngFromBase64E7, latLngRectFromBase64E7 } from './common/data';
import { degreesE7ToLatLng, projectLatLng } from './common/math';
import { emptyS2Polygon } from './common/types';
import { Boundary, ElevationProfile, Trail, TrailFact } from './models/types';

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
        const samples = [];
        const sampleStream = new LittleEndianView(decodeBase64(p.samples_meters));
        while (sampleStream.hasRemaining()) {
          samples.push(sampleStream.getFloat32());
        }

        return [
          BigInt(p.id),
          new ElevationProfile(p.granularity_meters, samples),
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
  const bound = latLngRectFromBase64E7(raw.bound);
  const marker = latLngFromBase64E7(raw.marker);
  return new Trail(
      BigInt(raw.id),
      raw.readable_id,
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

export function trailFactsFromRaw(raw: DataResponses['trail_facts']): TrailFact[] {
  return raw.facts.map(({predicate, value}) => ({
    predicate,
    value: JSON.parse(value),
  }));
}

