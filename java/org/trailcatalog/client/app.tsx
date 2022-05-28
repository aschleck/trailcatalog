import { checkExhaustive, checkExists } from 'js/common/asserts';
import * as corgi from 'js/corgi';

import { OverviewElement } from './overview_element';
import { RouteController, State } from './route_controller';
import { TrailOverviewElement } from './trail_overview_element';

import './app.css';

// TODO: assert little endian

//new Controller(document.getElementById('canvas') as HTMLCanvasElement);

function App(props: {}, state: State|undefined, updateState: (newState: State) => void) {
  if (!state) {
    state = RouteController.getInitialState();
  }

  let route;
  if (state.active.kind === 'boundary_overview') {
    route = <OverviewElement boundary={state.active.boundary} />;
  } else if (state.active.kind === 'global_overview') {
    route = <OverviewElement />;
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

corgi.appendElement(checkExists(document.getElementById('root')), <App />);
