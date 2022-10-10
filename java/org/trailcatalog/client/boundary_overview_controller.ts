import { SimpleS2 } from 'java/org/trailcatalog/s2/SimpleS2';
import { checkExists } from 'js/common/asserts';
import { Controller, Response } from 'js/corgi/controller';
import { CorgiEvent } from 'js/corgi/events';

import { decodeBase64 } from './common/base64';
import { emptyLatLngRect, emptyPixelRect, emptyS2Polygon, LatLng } from './common/types';
import { Boundary, Trail } from './models/types';
import { ViewsService } from './views/views_service';

import { DataResponses, fetchData } from './data';
import { Deps, State as VState, ViewportController } from './viewport_controller';

interface Args {
  boundaryId: bigint;
}

export interface State extends VState {
  boundary: Boundary|undefined;
  containingBoundaries: Boundary[]|undefined;
  trailsInBoundary: Trail[]|undefined;
}

export class BoundaryOverviewController extends ViewportController<Args, Deps, State> {

  static deps() {
    return {
      services: {
        views: ViewsService,
      },
    };
  }

  constructor(response: Response<BoundaryOverviewController>) {
    super(response);

    const id = `${response.args.boundaryId}`;
    if (!this.state.boundary) {
      fetchData('boundary', {id}).then(raw => {
        this.updateState({
          ...this.state,
          boundary: boundaryFromRaw(raw),
        });
      });
    }

    if (!this.state.containingBoundaries) {
      fetchData('boundaries_containing_boundary', {child_id: id}).then(raw => {
        this.updateState({
          ...this.state,
          containingBoundaries: containingBoundariesFromRaw(raw),
        });
      });
    }

    if (!this.state.trailsInBoundary) {
      fetchData('trails_in_boundary', {boundary_id: id}).then(raw => {
        this.updateState({
          ...this.state,
          trailsInBoundary: trailsInBoundaryFromRaw(raw),
        });
      });
    }
  }

  viewNearbyTrails(): void {
    this.views.showOverview(this.lastCamera);
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
              t.name,
              t.type,
              emptyPixelRect(),
              [],
              emptyLatLngRect(),
              [0, 0] as LatLng,
              [0, 0],
              t.length_meters));
}
