import { Controller, Response } from 'js/corgi/controller';

import { Route, ViewsService } from './views/views_service';

export interface State {
  active: Route;
}

type Deps = typeof RouteController.deps;

export class RouteController extends Controller<{}, Deps, HTMLDivElement, State> {

  static getInitialState(): State {
    return {
      active: ViewsService.getActiveRoute(),
    };
  }

  static deps() {
    return {
      services: {
        views: ViewsService,
      },
    };
  }

  private readonly views: ViewsService;

  constructor(response: Response<RouteController>) {
    super(response);
    this.views = response.deps.services.views;
    this.views.addListener(this);
    this.registerDisposer(() => {
      this.views.removeListener(this);
    });
  }

  routeChanged(active: Route): Promise<void> {
    return this.updateState({
      active,
    });
  }
}
