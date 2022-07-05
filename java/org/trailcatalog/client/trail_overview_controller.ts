import { Controller, Response } from 'js/corgi/controller';
import { CorgiEvent } from 'js/corgi/events';

import { LatLngZoom } from './common/types';
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
  private controller: MapController|undefined;
  private lastCamera: {lat: number; lng: number; zoom: number}|undefined;

  constructor(response: Response<TrailOverviewController>) {
    super(response);
    this.data = response.deps.services.data;
    this.views = response.deps.services.views;

    this.data.setPins({trail: response.args.trailId}).then(trail => {
      this.updateState({
        ...this.state,
        trail,
      });
    });
  }

  // This may not always fire prior to the person hitting nearby trails, which is bad
  onMove(e: CorgiEvent<typeof MAP_MOVED>): void {
    const {controller, center, zoom} = e.detail;
    this.controller = controller;
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
    this.data.clearPins();
    this.views.showOverview(this.lastCamera);
  }

  zoomToFit(): void {
    if (this.state.trail) {
      this.controller?.setCamera(boundingLlz(this.state.trail));
    }
  }
}

export function boundingLlz(trail: Trail): LatLngZoom {
  const dLL = [
    trail.bound.high[0] - trail.bound.low[0],
    trail.bound.high[1] - trail.bound.low[1],
  ];
  const center = [
    trail.bound.low[0] + dLL[0] / 2,
    trail.bound.low[1] + dLL[1] / 2,
  ];
  const zoom = Math.log(512 / Math.max(dLL[0], dLL[1])) / Math.log(2);
  return {lat: center[0], lng: center[1], zoom};
}
