import { S2LatLng } from 'java/org/trailcatalog/s2';
import { Controller, Response } from 'js/corgi/controller';
import { CorgiEvent } from 'js/corgi/events';

import { screenLlz } from './common/math';
import { MapDataService } from './data/map_data_service';
import { MAP_MOVED } from './map/events';
import { Boundary, Trail } from './models/types';
import { ViewsService } from './views/views_service';

import { DataResponses, fetchData } from './data';
import { containingBoundariesFromRaw } from './trails';
import { State as VState, ViewportController } from './viewport_controller';

interface Args {
  trailId: bigint;
}

export interface State extends VState {
  containingBoundaries: Boundary[]|undefined;
  showZoomToFit: boolean;
  trail: Trail|undefined;
}

type Deps = typeof TrailOverviewController.deps;

export class TrailOverviewController extends ViewportController<Args, Deps, State> {

  static deps() {
    return {
      services: {
        data: MapDataService,
        views: ViewsService,
      },
    };
  }

  private readonly data: MapDataService;
  private center: S2LatLng|undefined;

  constructor(response: Response<TrailOverviewController>) {
    super(response);
    this.data = response.deps.services.data;

    const id = response.args.trailId;

    this.data.setPins({trail: id}).then(trail => {
      const llz = screenLlz(trail.bound, new DOMRect());
      this.center = S2LatLng.fromDegrees(llz.lat, llz.lng);

      this.updateState({
        ...this.state,
        trail,
      });
    });

    if (!this.state.containingBoundaries) {
      fetchData('boundaries_containing_trail', {trail_id: {numeric: `${id}`}}).then(raw => {
        this.updateState({
          ...this.state,
          containingBoundaries: containingBoundariesFromRaw(raw),
        });
      });
    }
  }

  // This may not always fire prior to the person hitting nearby trails, which is bad
  onMove(e: CorgiEvent<typeof MAP_MOVED>): void {
    const {center} = e.detail;
    super.onMove(e);

    if (!this.state.showZoomToFit && this.center) {
      if (!center.equals(this.center)) {
        this.updateState({
          ...this.state,
          showZoomToFit: true,
        });
      }
    }
  }

  viewNearbyTrails(): void {
    this.data.clearPins();
    this.views.showOverview(this.lastCamera);
  }

  zoomToFit(): void {
    if (this.state.trail) {
      this.mapController?.setCamera(this.state.trail.bound);
    }

    this.updateState({
      ...this.state,
      showZoomToFit: false,
    });
  }
}

