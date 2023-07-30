import { checkExists } from 'js/common/asserts';

import { Service, ServiceResponse } from '../service';

import { HistoryService } from './history_service';

export type DiscriminatedRoute<R> = {[K in keyof R]: {
    kind: K;
  } & R[K];
}[keyof R];

type RouteMatchers<R> = {[k in keyof R]: RegExp};

interface Listener<R> {
  routeChanged(active: DiscriminatedRoute<R>, parameters: {[key: string]: string}): Promise<void>;
}

type Deps = typeof ViewsService.deps;

export class ViewsService<R> extends Service<Deps> {

  static deps() {
    return {
      services: {
        history: HistoryService,
      },
    };
  }

  private readonly history: HistoryService;
  private readonly listeners: Set<Listener<R>>;
  private readonly routes: Partial<RouteMatchers<R>>;

  constructor(response: ServiceResponse<Deps>) {
    super(response);
    this.history = response.deps.services.history;
    this.listeners = new Set();
    this.routes = {};

    this.history.addListener(this);
  }

  addRoutes(routes: RouteMatchers<R>) {
    Object.assign(this.routes, routes);
  }

  goTo(url: string) {
    this.history.goTo(url);
  }

  urlChanged(url: URL): Promise<void> {
    const active = checkExists(matchPath(url.pathname, this.routes));
    const parameters = Object.fromEntries(new URLSearchParams(url.search).entries());
    const promises = [];
    for (const listener of this.listeners) {
      promises.push(listener.routeChanged(active, parameters));
    }
    return Promise.all(promises).then(() => {});
  }

  addListener(listener: Listener<R>): void {
    this.listeners.add(listener);
  }

  removeListener(listener: Listener<R>): void {
    this.listeners.delete(listener);
  }
}

export function matchPath<R>(path: string, routes: Partial<RouteMatchers<R>>):
    DiscriminatedRoute<R>|undefined {
  for (const [kind, regex] of Object.entries(routes)) {
    const match = (regex as RegExp).exec(path);
    if (match) {
      const groups: {[key: string]: string} = {};
      for (const [key, value] of Object.entries(match.groups ?? {})) {
        groups[key] = decodeURIComponent(value);
      }
      return {
        kind,
        ...groups,
      } as DiscriminatedRoute<R>;
    }
  }
  return undefined;
}
