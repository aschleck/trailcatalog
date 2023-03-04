import { checkExhaustive, checkExists } from 'js/common/asserts';
import * as corgi from 'js/corgi';
import { CHANGED } from 'js/dino/events';
import { OutlinedInput } from 'js/dino/input';
import { Select } from 'js/dino/select';
import { MapElement } from 'js/map/map_element';

import { State, ViewerController, ZOOM_LEVEL } from './viewer_controller';

import './app.css';

function App({}: {}, state: State|undefined, updateState: (newState: State) => void) {
  if (!state) {
    state = {
      cells: [],
      level: ZOOM_LEVEL,
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
      <div className="absolute flex gap-2 top-4 right-4">
        <OutlinedInput
            className="bg-white text-xs"
            dense={true}
            forceValue={true}
            unboundEvents={{corgi: [[CHANGED, 'showCells']]}}
            value={state.cells.join(',')}
        />
        <Select
            className="bg-white text-xs"
            unboundEvents={{corgi: [[CHANGED, 'setLevel']]}}
            options={[
              {label: 'zoom', value: String(ZOOM_LEVEL)},
              ...[...Array(31).keys()].map(i => ({label: String(i), value: String(i)})),
            ]}
        />
      </div>
    </div>
  </div>;
}

corgi.appendElement(checkExists(document.getElementById('root')), <App />);
