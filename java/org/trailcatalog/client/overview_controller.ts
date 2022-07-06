import { Controller, Response } from 'js/corgi/controller';
import { CorgiEvent } from 'js/corgi/events';

import { checkExists } from './common/asserts';
import { DATA_CHANGED, HOVER_CHANGED, MAP_MOVED } from './map/events';
import { Path, Trail } from './models/types';
import { ViewsService } from './views/views_service';

import { Deps, State as VState, ViewportController } from './viewport_controller';

export interface State extends VState {
  trails: Trail[];
}

export class OverviewController extends ViewportController<{}, Deps, State> {

  static deps() {
    return {
      services: {
        views: ViewsService,
      },
    };
  }

  constructor(response: Response<OverviewController>) {
    super(response);
  }

  onDataChange(e: CorgiEvent<typeof DATA_CHANGED>): void {
    const {controller} = e.detail;
    this.mapController = controller;
    this.updateState({
      ...this.state,
      trails: controller.listTrailsInViewport()
          .sort((a, b) => b.lengthMeters - a.lengthMeters),
    });
  }

  onHoverChanged(e: CorgiEvent<typeof HOVER_CHANGED>): void {
    const {controller} = e.detail;
    this.mapController = controller;
    this.updateState({
      ...this.state,
      hovering: e.detail.target,
    });
  }

  onMove(e: CorgiEvent<typeof MAP_MOVED>): void {
    const {controller} = e.detail;
    this.mapController = controller;
    this.updateState({
      ...this.state,
      trails: controller.listTrailsInViewport()
          .sort((a, b) => b.lengthMeters - a.lengthMeters),
    });
  }
}

