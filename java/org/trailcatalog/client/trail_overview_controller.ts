import { Controller, Response } from 'js/corgi/controller';
import { CorgiEvent } from 'js/corgi/events';

import { MapDataService } from './data/map_data_service';
import { MapController, MAP_MOVED } from './map/events';
import { Trail } from './models/types';
import { ViewsService } from './views/views_service';

interface Args {
  trailId: bigint;
}

export interface State {
  nearbyTrails: Trail[]|undefined;
  trail: Trail|undefined;
}

type Deps = typeof TrailOverviewController.deps;

export class TrailOverviewController extends Controller<Args, Deps, HTMLElement, State> {

  static deps() {
    return {
      services: {
        data: MapDataService,
        views: ViewsService,
      },
    };
  }

  private readonly data: MapDataService;
  private readonly views: ViewsService;
  private lastCamera: {lat: number; lng: number; zoom: number}|undefined;

  constructor(response: Response<TrailOverviewController>) {
    super(response);
    this.data = response.deps.services.data;
    this.views = response.deps.services.views;

    this.data.setPins({trail: response.args.trailId});

    this.updateState({
      ...this.state,
      // TODO(april): we should be able to load trails if they aren't present to support in-app
      // cross-linking.
      trail: this.data.trails.get(response.args.trailId) ?? this.state.trail,
    });
  }

  // This may not always fire prior to the person hitting nearby trails, which is bad
  onMove(e: CorgiEvent<typeof MAP_MOVED>): void {
    const {controller, center, zoom} = e.detail;
    this.lastCamera = {
      lat: center.latDegrees(),
      lng: center.lngDegrees(),
      zoom,
    };

    if (this.state.trail) {
      controller.setActive(this.state.trail, true);
    }

    const nearby = 
          controller.listTrailsInViewport()
              .filter(t => t.id !== this.state.trail?.id)
              .sort((a, b) => b.lengthMeters - a.lengthMeters);
    this.updateState({
      ...this.state,
      nearbyTrails: nearby,
    });
  }

  viewNearbyTrails(): void {
    this.views.showOverview(this.lastCamera);
  }
}

