import { Controller, Response } from 'js/corgi/controller';
import { CorgiEvent } from 'js/corgi/events';

import { boundingLlz } from './common/math';
import { emptyS2Polygon } from './common/types';
import { MapDataService } from './data/map_data_service';
import { MapController, MAP_MOVED } from './map/events';
import { Boundary, Trail } from './models/types';
import { ViewsService } from './views/views_service';

import { DataResponses, fetchData } from './data';
import { State as VState, ViewportController } from './viewport_controller';

interface Args {
  trailId: bigint;
}

export interface State extends VState {
  containingBoundaries: Boundary[]|undefined;
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

  constructor(response: Response<TrailOverviewController>) {
    super(response);
    this.data = response.deps.services.data;

    const id = response.args.trailId;

    this.data.setPins({trail: id}).then(trail => {
      this.updateState({
        ...this.state,
        trail,
      });
    });

    if (!this.state.containingBoundaries) {
      fetchData('boundaries_containing_trail', {trail_id: `${id}`}).then(raw => {
        this.updateState({
          ...this.state,
          containingBoundaries: containingBoundariesFromRaw(raw),
        });
      });
    }

  }

  // This may not always fire prior to the person hitting nearby trails, which is bad
  onMove(e: CorgiEvent<typeof MAP_MOVED>): void {
    if (this.state.trail) {
      // This is bad here. We already have a loading screen before showing the map, so we can just
      // pass the active trail in as a map arg. Oh well.
      const {controller} = e.detail;
      controller.setActive(this.state.trail, true);
    }

    super.onMove(e);
  }

  viewNearbyTrails(): void {
    this.data.clearPins();
    this.views.showOverview(this.lastCamera);
  }

  zoomToFit(): void {
    if (this.state.trail) {
      this.mapController?.setCamera(boundingLlz(this.state.trail.bound));
    }
  }
}

export function containingBoundariesFromRaw(
    raw: DataResponses['boundaries_containing_trail']): Boundary[] {
  return raw.map(
      b =>
          new Boundary(
              BigInt(b.id),
              b.name,
              b.type,
              emptyS2Polygon()));
}

