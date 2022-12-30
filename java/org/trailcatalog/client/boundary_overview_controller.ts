import { SimpleS2 } from 'java/org/trailcatalog/s2/SimpleS2';

import { decodeBase64 } from './common/base64';
import { emptyLatLngRect, emptyPixelRect, emptyS2Polygon, LatLng } from './common/types';
import { Boundary, Trail } from './models/types';

import { DataResponses } from './data';

// TODO(april): move these somewhere else

export function boundaryFromRaw(raw: DataResponses['boundary']): Boundary {
  return new Boundary(
      BigInt(raw.id),
      raw.name,
      raw.type,
      SimpleS2.decodePolygon(decodeBase64(raw.s2_polygon)));
}

export function containingBoundariesFromRaw(raw: DataResponses['boundaries_containing_boundary']): Boundary[] {
  return raw.boundaries.map(
      b =>
          new Boundary(
              BigInt(b.id),
              b.name,
              b.type,
              emptyS2Polygon()));
}

export function trailsInBoundaryFromRaw(raw: DataResponses['trails_in_boundary']): Trail[] {
  return raw.trails.map(
      t =>
          new Trail(
              BigInt(t.id),
              /* readable_id= */ undefined,
              t.name,
              t.type,
              emptyPixelRect(),
              [],
              emptyLatLngRect(),
              [0, 0] as LatLng,
              [0, 0],
              t.elevation_down_meters,
              t.elevation_up_meters,
              t.length_meters));
}
