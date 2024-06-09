import { checkExists } from 'external/dev_april_corgi~/js/common/asserts';
import { Controller, Response } from 'external/dev_april_corgi~/js/corgi/controller';
import { DiscriminatedRoute, matchPath, ViewsService } from 'external/dev_april_corgi~/js/corgi/history/views_service';
import { currentUrl } from 'external/dev_april_corgi~/js/server/ssr_aware';

export interface Routes {
  citations: {};
  overview: {};
}

const routes: {[k in keyof Routes]: RegExp} = {
  'citations': /^\/citations$/,
  'overview': /^\/$/,
} as const;

export interface State {
  active: DiscriminatedRoute<Routes>;
  parameters: {[key: string]: string};
}

type Deps = typeof RouteController.deps;

export class RouteController extends Controller<{}, Deps, HTMLDivElement, State> {

  static getInitialState(): State {
    const url = currentUrl();
    return {
      active: checkExists(matchPath<Routes>(url.pathname, routes)),
      parameters: Object.fromEntries(new URLSearchParams(url.search).entries()),
    };
  }

  static deps() {
    return {
      services: {
        views: ViewsService<Routes>,
      },
    };
  }

  private readonly views: ViewsService<Routes>;

  constructor(response: Response<RouteController>) {
    super(response);
    this.views = response.deps.services.views;
    this.views.addListener(this);
    this.views.addRoutes(routes);

    this.registerDisposer(() => {
      this.views.removeListener(this);
    });
  }

  routeChanged(active: DiscriminatedRoute<Routes>, parameters: {[key: string]: string}):
      Promise<void> {
    return this.updateState({
      active,
      parameters,
    });
  }
}

