import { checkExhaustive, checkExists } from 'js/common/asserts';
import * as corgi from 'js/corgi';
import { OutlinedInput } from 'js/dino/input';
import { MapElement } from 'js/map/map_element';

import { State, ViewerController } from './viewer_controller';

import './app.css';

function App({}: {}, state: State|undefined, updateState: (newState: State) => void) {
  if (!state) {
    state = {
      cells: [],
    };
  }

  return <div className="h-full">
    <div
        js={corgi.bind({
          controller: ViewerController,
          events: {render: 'wakeup'},
          state: [state, updateState],
        })}
        className="h-full"
    >
      <MapElement 
          camera={{lat: 46.859369, lng: -121.747888, zoom: 12}}
          ref="map"
      />
      <div className="absolute top-4 right-4">
        <OutlinedInput className="bg-white text-xs" value={state.cells.join(',')} />
      </div>
    </div>
  </div>;
}

corgi.appendElement(checkExists(document.getElementById('root')), <App />);
