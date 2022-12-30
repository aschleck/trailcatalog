import { SimpleS2 } from 'java/org/trailcatalog/s2/SimpleS2';
import { Controller, Response } from 'js/corgi/controller';
import { EmptyDeps } from 'js/corgi/deps';
import { CorgiEvent } from 'js/corgi/events';

import { decodeBase64 } from './common/base64';
import { emptyLatLngRect, emptyPixelRect, emptyS2Polygon, LatLng } from './common/types';
import { Boundary, Trail } from './models/types';

import { DataResponses, fetchData } from './data';
import { State as VState, ViewportController } from './viewport_controller';

interface Args {
  boundaryId: string;
}

export interface State extends VState {
  boundary?: Boundary;
  containingBoundaries?: Boundary[];
  trailsInBoundary: Trail[]|undefined;
}

export class BoundaryDetailController extends ViewportController<Args, EmptyDeps, State> {

  constructor(response: Response<BoundaryDetailController>) {
    super(response);

    const boundaryId = response.args.boundaryId;
    if (!this.state.boundary) {
      fetchData('boundary', {id: boundaryId}).then(raw => {
        const boundary = boundaryFromRaw(raw);
        this.updateState({
          ...this.state,
          boundary,
        });
      });
    }

    if (!this.state.containingBoundaries) {
      fetchData('boundaries_containing_boundary', {child_id: boundaryId}).then(raw => {
        this.updateState({
          ...this.state,
          containingBoundaries: containingBoundariesFromRaw(raw),
        });
      });
    }

    if (!this.state.trailsInBoundary) {
      fetchData('trails_in_boundary', {boundary_id: boundaryId}).then(raw => {
        this.updateState({
          ...this.state,
          trailsInBoundary: trailsInBoundaryFromRaw(raw),
        });
      });
    }
  }
}

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
