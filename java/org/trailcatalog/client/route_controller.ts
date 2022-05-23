import { Controller, ControllerResponse } from 'js/corgi/controller';
import { EmptyDeps } from 'js/corgi/deps';

import { checkExists } from './common/asserts';

interface BoundaryOverview {
  kind: 'boundary_overview';
  boundary: string;
}

interface GlobalOverview {
  kind: 'global_overview';
}

export type Route = BoundaryOverview|GlobalOverview;

const routes = new Map<Route['kind'], RegExp>([
  ['boundary_overview', /^\/boundary\/(?<boundary>\d+)$/],
  ['global_overview', /^\/$/],
]);

export interface State {
  active: Route;
}

interface Response extends ControllerResponse<undefined, EmptyDeps, HTMLDivElement, State> {
  state: [State, (newState: State) => void];
}

export class RouteController extends Controller<undefined, EmptyDeps, HTMLDivElement, State, Response> {

  constructor(response: Response) {
    super(response);
  }

  // TODO(april): register for history
}

function matchPath(path: string): Route|undefined {
  for (const [kind, regex] of routes.entries()) {
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

export function getActiveRoute(): Route {
  const url = new URL(window.location.href);
  return checkExists(matchPath(url.pathname));
}
