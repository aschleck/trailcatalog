import { checkExists } from 'js/common/asserts';
import { HistoryService } from 'js/corgi/history/history_service';
import { Service, ServiceResponse } from 'js/corgi/service';

interface BoundaryOverview {
  kind: 'boundary_overview';
  boundary: string;
}

interface GlobalOverview {
  kind: 'global_overview';
}

interface TrailOverview {
  kind: 'trail_overview';
  trail: string;
}

export type Route = BoundaryOverview|GlobalOverview|TrailOverview;

const routes: {[k in Route['kind']]: RegExp} = {
  'boundary_overview': /^\/boundary\/(?<boundary>\d+)$/,
  'global_overview': /^\/$/,
  'trail_overview': /^\/trail\/(?<trail>\d+)$/,
};

interface Listener {
  routeChanged(active: Route): void;
}

type Deps = typeof ViewsService.deps;

export class ViewsService extends Service<Deps> {

  static getActiveRoute(): Route {
    const url = new URL(window.location.href);
    return checkExists(matchPath(url.pathname));
  }

  static deps() {
    return {
      services: {
        history: HistoryService,
      },
    };
  }

  private readonly history: HistoryService;
  private readonly listeners: Set<Listener>;

  constructor(response: ServiceResponse<Deps>) {
    super(response);
    this.history = response.deps.services.history;
    this.listeners = new Set();

    this.history.addListener(this);
  }

  urlChanged(url: URL): void {
    const active = checkExists(matchPath(url.pathname));
    if (active) {
      for (const listener of this.listeners) {
        listener.routeChanged(active);
      }
    } else {
      console.error(`Unable to find a route for ${url}`);
    }
  }

  addListener(listener: Listener): void {
    this.listeners.add(listener);
  }

  removeListener(listener: Listener): void {
    this.listeners.delete(listener);
  }

  showTrail(id: number): void {
    this.history.goTo(`/trail/${id}`);
  }
}

function matchPath(path: string): Route|undefined {
  for (const [kind, regex] of Object.entries(routes)) {
    const match = regex.exec(path);
    if (match) {
      return {
        kind,
        ...match.groups,
      } as Route;
    }
  }
  return undefined;
}

