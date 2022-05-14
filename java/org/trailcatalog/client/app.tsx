import * as corgi from 'js/corgi';

import { checkExhaustive, checkExists } from './common/asserts';

import { OverviewElement } from './overview_element';
import { getActiveRoute, RouteController, State } from './route_controller';

import './app.css';

// TODO: assert little endian

//new Controller(document.getElementById('canvas') as HTMLCanvasElement);

function App(props: {}, state: State|undefined, updateState: (newState: State) => void) {
  if (!state) {
    state = {
      active: getActiveRoute(),
    };
  }

  let route;
  if (state.active.kind === 'boundary_overview') {
    route = <OverviewElement boundary={state.active.boundary} />;
  } else if (state.active.kind === 'global_overview') {
    route = <OverviewElement />;
  } else {
    checkExhaustive(state.active);
  }

  return <>
    <div
        js={corgi.bind({
          controller: RouteController,
          args: undefined,
          state: [state, updateState],
        })}
        className="h-full"
    >
      {route}
    </div>
  </>;
}

corgi.appendElement(checkExists(document.getElementById('root')), <App />);
