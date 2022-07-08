import { Controller, Response } from 'js/corgi/controller';
import { CorgiEvent } from 'js/corgi/events';

import { ViewsService } from './views/views_service';

import { Deps, State, ViewportController } from './viewport_controller';

export { State } from './viewport_controller';

// TODO(april): delete?
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
}

