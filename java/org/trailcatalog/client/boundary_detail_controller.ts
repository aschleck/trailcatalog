import { SimpleS2 } from 'java/org/trailcatalog/s2/SimpleS2';
import { Controller, Response } from 'js/corgi/controller';
import { EmptyDeps } from 'js/corgi/deps';
import { CorgiEvent } from 'js/corgi/events';
import { emptyLatLngRect, emptyPixelRect, LatLng } from 'js/map/common/types';

import { decodeBase64 } from './common/base64';
import { emptyS2Polygon } from './common/types';
import { Boundary, Trail } from './models/types';

import { DataResponses, fetchData } from './data';
import { Args, State as VState, ViewportController } from './viewport_controller';

export interface State extends VState {
  boundary?: Boundary;
  boundaryId: string;
  containingBoundaries?: Boundary[];
  trailsInBoundary: Trail[]|undefined;
}

type Deps = typeof BoundaryDetailController.deps;

export class LoadingController extends Controller<{}, EmptyDeps, HTMLElement, State> {

  constructor(response: Response<LoadingController>) {
    super(response);

    const boundaryId = this.state.boundaryId;
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

export class BoundaryDetailController extends ViewportController<Args, Deps, State> {

  static deps() {
    return ViewportController.deps();
  }

  constructor(response: Response<BoundaryDetailController>) {
    super(response);
  }

  browseMap() {
    this.views.showSearchResults({
      boundary: this.state.boundary?.id,
      camera: this.mapController.cameraLlz,
    });
  }

  zoomToFit(): void {
    if (this.state.boundary) {
      this.mapController?.setCamera(this.state.boundary.bound);
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
