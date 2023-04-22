import { checkExists, exists } from 'js/common/asserts';
import { HistoryService } from 'js/corgi/history/history_service';
import { Service, ServiceResponse } from 'js/corgi/service';
import { currentUrl } from 'js/server/ssr_aware';

interface BoundaryDetail {
  kind: 'boundary_detail';
  id: string;
}

interface GoToTrail {
  kind: 'go_to_trail';
  id: string;
}

interface SearchResults {
  kind: 'search_results';
}

interface TrailDetail {
  kind: 'trail_detail';
  trail: string;
}

export type Route = BoundaryDetail|GoToTrail|SearchResults|TrailDetail;

const routes: {[k in Route['kind']]: RegExp} = {
  'boundary_detail': /^\/boundary\/(?<id>\d+)$/,
  'go_to_trail': /^\/goto\/trail\/(?<id>\d+)$/,
  'search_results': /^\/(search)?$/,
  'trail_detail': /^\/trail\/(?<trail>.+)$/,
};

interface Listener {
  routeChanged(active: Route, parameters: {[key: string]: string}): Promise<void>;
}

type Deps = typeof ViewsService.deps;

export class ViewsService extends Service<Deps> {

  static getActiveRoute(): {
    active: Route;
    parameters: {[key: string]: string};
  } {
    const url = currentUrl();
    return {
      active: checkExists(matchPath(url.pathname)),
      parameters: Object.fromEntries(new URLSearchParams(url.search).entries()),
    };
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

  urlChanged(url: URL): Promise<void> {
    const active = checkExists(matchPath(url.pathname));
    const parameters = Object.fromEntries(new URLSearchParams(url.search).entries());
    const promises = [];
    for (const listener of this.listeners) {
      promises.push(listener.routeChanged(active, parameters));
    }
    return Promise.all(promises).then(() => {});
  }

  addListener(listener: Listener): void {
    this.listeners.add(listener);
  }

  removeListener(listener: Listener): void {
    this.listeners.delete(listener);
  }

  showOverview(camera?: {lat: number, lng: number, zoom: number}): void {
    if (camera) {
      this.history.goTo(`/?lat=${camera.lat}&lng=${camera.lng}&zoom=${camera.zoom}`);
    } else {
      this.history.goTo('/');
    }
  }

  showSearchResults({boundary, camera, query}: {
    boundary?: bigint,
    camera?: {lat: number, lng: number, zoom: number},
    query?: string,
  }): void {
    const filters = [
      boundary ? `boundary=${boundary}` : undefined,
      camera ? `lat=${camera.lat}&lng=${camera.lng}&zoom=${camera.zoom}` : undefined,
      query ? `query=${encodeURIComponent(query)}` : undefined,
    ].filter(exists);
    this.history.goTo(`/search?${filters.join('&')}`);
  }

  showTrail(id: bigint): void {
    this.history.goTo(`/goto/trail/${id}`);
  }
}

function matchPath(path: string): Route|undefined {
  for (const [kind, regex] of Object.entries(routes)) {
    const match = regex.exec(path);
    if (match) {
      const groups: {[key: string]: string} = {};
      for (const [key, value] of Object.entries(match.groups ?? {})) {
        groups[key] = decodeURIComponent(value);
      }
      return {
        kind,
        ...groups,
      } as Route;
    }
  }
  return undefined;
}

