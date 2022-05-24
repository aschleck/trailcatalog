import { Controller, ControllerResponse, RequestSpec } from 'js/corgi/controller';

import { Route, ViewsService } from './views/views_service';

interface Deps {
  services: {
    views: ViewsService;
  };
}

export interface State {
  active: Route;
}

interface Response extends ControllerResponse<undefined, Deps, HTMLDivElement, State> {
  state: [State, (newState: State) => void];
}

export class RouteController extends Controller<undefined, Deps, HTMLDivElement, State, Response> {

  static getInitialState(): State {
    return {
      active: ViewsService.getActiveRoute(),
    };
  }

  static deps(): RequestSpec<Deps> {
    return {
      services: {
        views: ViewsService,
      },
    };
  }

  private readonly views: ViewsService;

  constructor(response: Response) {
    super(response);
    this.views = response.deps.services.views;
    this.views.addListener(this);
    this.registerDisposer(() => {
      this.views.removeListener(this);
    });
  }

  routeChanged(active: Route): void {
    this.updateState({
      active,
    });
  }
}
