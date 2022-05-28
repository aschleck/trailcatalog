import { Controller, Response } from 'js/corgi/controller';

import { Trail } from './models/types';
import { MapDataService } from './data/map_data_service';

interface Args {
  trailId: bigint;
}

export interface State {
  trail: Trail|undefined;
}

type Deps = typeof TrailOverviewController.deps;

export class TrailOverviewController extends Controller<Args, Deps, HTMLElement, State> {

  static deps() {
    return {
      services: {
        data: MapDataService,
      },
    };
  }

  private data: MapDataService;

  constructor(response: Response<TrailOverviewController>) {
    super(response);
    this.data = response.deps.services.data;

    this.updateState({
      trail: this.data.trails.get(response.args.trailId),
    });
  }
}

