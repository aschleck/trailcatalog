import { Future } from 'external/dev_april_corgi+/js/common/futures';
import { Controller, Response } from 'external/dev_april_corgi+/js/corgi/controller';
import { EmptyDeps } from 'external/dev_april_corgi+/js/corgi/deps';
import { CorgiEvent } from 'external/dev_april_corgi+/js/corgi/events';

import { SimpleS2 } from 'java/org/trailcatalog/s2/SimpleS2';
import { LatLng, LatLngRect } from 'js/map/common/types';

import { decodeBase64 } from './common/base64';
import { emptyPixelRect, emptyS2Polygon } from './common/types';
import { Boundary, Trail } from './models/types';

import { DataResponses, fetchData } from './data';
import * as routes from './routes';
import { Args, State as VState, ViewportController } from './viewport_controller';

export interface State extends VState {
  boundary: Future<Boundary>;
  boundaryId: string;
  containingBoundaries: Future<Boundary[]>;
  trailsInBoundary: Future<Trail[]>;
}

type Deps = typeof BoundaryDetailController.deps;

export class BoundaryDetailController extends ViewportController<Args, Deps, State> {

  static deps() {
    return ViewportController.deps();
  }

  constructor(response: Response<BoundaryDetailController>) {
    super(response);
  }

  browseMap() {
    routes.showSearchResults({
      boundary: this.state.boundary.value().id,
      camera: this.mapController.cameraLlz,
    }, this.views);
  }

  zoomToFit(): void {
    this.mapController?.setCamera(this.state.boundary.value().bound);
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
              {
                low: [90, 180],
                high: [-90, -180],
                brand: 'LatLngRect',
              },
              [0, 0] as const as LatLng,
              [0, 0],
              t.elevation_down_meters,
              t.elevation_up_meters,
              t.length_meters));
}
