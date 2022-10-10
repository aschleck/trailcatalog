import { checkExhaustive, checkExists } from 'js/common/asserts';
import * as corgi from 'js/corgi';

import { isServerSide } from './common/ssr_aware';

import { BoundaryOverviewElement } from './boundary_overview_element';
import { RouteController, State } from './route_controller';
import { SearchResultsOverviewElement } from './search_results_overview_element';
import { TrailOverviewElement } from './trail_overview_element';

import './app.css';

// TODO: assert little endian

//new Controller(document.getElementById('canvas') as HTMLCanvasElement);

export function App(props: {}, state: State|undefined, updateState: (newState: State) => void) {
  if (!state) {
    state = RouteController.getInitialState();
  }

  let route;
  if (state.active.kind === 'boundary_overview') {
    route = <BoundaryOverviewElement boundaryId={state.active.boundary} />;
  } else if (state.active.kind === 'search_results_overview') {
    route = <SearchResultsOverviewElement />;
  } else if (state.active.kind === 'trail_overview') {
    route = <TrailOverviewElement trailId={state.active.trail} />;
  } else {
    checkExhaustive(state.active);
  }

  return <>
    <div
        js={corgi.bind({
          controller: RouteController,
          events: {
            render: 'wakeup',
          },
          state: [state, updateState],
        })}
        className="h-full"
    >
      {route}
    </div>
  </>;
}

if (!isServerSide()) {
  corgi.hydrateTree(checkExists(document.getElementById('root')), <App />);
}
