import { formatArea } from 'java/org/trailcatalog/client/common/formatters';
import { S2CellId } from 'java/org/trailcatalog/s2';
import { SimpleS2 } from 'java/org/trailcatalog/s2/SimpleS2';
import { checkExhaustive, checkExists } from 'js/common/asserts';
import { floatCoalesce } from 'js/common/math';
import * as corgi from 'js/corgi';
import { CHANGED } from 'js/dino/events';
import { OutlinedInput } from 'js/dino/input';
import { Select } from 'js/dino/select';
import { MAP_MOVED } from 'js/map/events';
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

  const parameters = Object.fromEntries(new URLSearchParams(window.location.search).entries());
  const llz = {
    lat: floatCoalesce(parameters.lat, 46.859369),
    lng: floatCoalesce(parameters.lng, -121.747888),
    zoom: floatCoalesce(parameters.zoom, 12),
  };

  return <div className="h-full">
    <div
        js={corgi.bind({
          controller: ViewerController,
          events: {
            corgi: [[MAP_MOVED, 'onMove']],
            render: 'wakeup',
          },
          state: [state, updateState],
        })}
        className="h-full"
    >
      <MapElement 
          camera={llz}
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
      {
        state.selected
            ? <CellPopup cell={state.selected.cell} position={state.selected.clickPx} />
            : <></>
      }
    </div>
  </div>;
}

function CellPopup({cell, position}: {cell: S2CellId, position: [number, number]}) {
  const area =
      formatArea(
          SimpleS2.cellIdToCell(cell).exactArea()
              * SimpleS2.EARTH_RADIUS_METERS
              * SimpleS2.EARTH_RADIUS_METERS);
  return <>
    <div
        className="
            absolute
            bg-white
            rounded
            p-2
            -translate-x-1/2
            translate-y-[calc(-100%-0.75rem)]
        "
        style={`left: ${position[0]}px; top: ${position[1]}px`}
    >
      <div className="font-bold">{cell.toToken()}</div>
      <div>level: {cell.level()}</div>
      <div>area: {area.value} {area.unit}</div>
      <div>min: {cell.rangeMin().id().toString(10)}</div>
      <div>max: {cell.rangeMax().id().toString(10)}</div>
    </div>
  </>;
}

corgi.appendElement(checkExists(document.getElementById('root')), <App />);
