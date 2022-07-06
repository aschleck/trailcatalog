import { Controller, Response } from 'js/corgi/controller';
import { CorgiEvent } from 'js/corgi/events';

import { checkExists } from './common/asserts';
import { Boundary } from './models/types';
import { ViewsService } from './views/views_service';

import { Deps, State as VState, ViewportController } from './viewport_controller';

interface Args {
  boundaryId: bigint;
}

export interface State extends VState {
  boundary: Boundary|undefined;
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
  }
}

