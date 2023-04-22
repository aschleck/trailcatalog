import { checkExhaustive, checkExists } from 'js/common/asserts';
import * as corgi from 'js/corgi';
import { isServerSide } from 'js/server/ssr_aware';

import { BoundaryDetailElement } from './boundary_detail_element';
import { GoToTrailElement } from './go_to_trail_element';
import { RouteController, State } from './route_controller';
import { SearchResultsOverviewElement } from './search_results_overview_element';
import { TrailDetailElement } from './trail_detail_element';

import './app.css';

// TODO: assert little endian

export function App(props: {}, state: State|undefined, updateState: (newState: State) => void) {
  if (!state) {
    state = RouteController.getInitialState();
  }

  let route;
  if (state.active.kind === 'boundary_detail') {
    route = <BoundaryDetailElement boundaryId={state.active.id} parameters={state.parameters} />;
  } else if (state.active.kind === 'go_to_trail') {
    route = <GoToTrailElement trailId={state.active.id} parameters={state.parameters} />;
  } else if (state.active.kind === 'search_results') {
    route = <SearchResultsOverviewElement parameters={state.parameters} />;
  } else if (state.active.kind === 'trail_detail') {
    route = <TrailDetailElement trailId={state.active.trail} parameters={state.parameters} />;
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
  corgi.hydrateElement(checkExists(document.getElementById('root')), <App />);
}
