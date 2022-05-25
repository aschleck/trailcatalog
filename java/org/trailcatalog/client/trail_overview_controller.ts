import { Controller, ControllerResponse, RequestSpec } from 'js/corgi/controller';
import { CorgiEvent } from 'js/corgi/events';

import { Trail } from './models/types';
import { MapDataService } from './data/map_data_service';

interface Args {
  trailId: bigint;
}

interface Deps {
  services: {
    data: MapDataService;
  };
}

export interface State {
  trail: Trail|undefined;
}

interface Response extends ControllerResponse<Args, Deps, HTMLElement, State> {
  state: [State, (newState: State) => void];
}

export class TrailOverviewController extends Controller<Args, Deps, HTMLElement, State, Response> {

  static deps(): RequestSpec<Deps> {
    return {
      services: {
        data: MapDataService,
      },
    };
  }

  private data: MapDataService;

  constructor(response: Response) {
    super(response);
    this.data = response.deps.services.data;

    this.updateState({
      trail: this.data.trails.get(response.args.trailId),
    });
  }
}

