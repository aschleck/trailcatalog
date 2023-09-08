import { formatArea } from 'java/org/trailcatalog/client/common/formatters';
import { S2CellId, S2LatLngRect } from 'java/org/trailcatalog/s2';
import { SimpleS2 } from 'java/org/trailcatalog/s2/SimpleS2';
import { checkExhaustive, checkExists } from 'js/common/asserts';
import { floatCoalesce } from 'js/common/math';
import * as corgi from 'js/corgi';
import { CHANGED } from 'js/dino/events';
import { OutlinedInput } from 'js/dino/input';
import { Select } from 'js/dino/select';
import { MAP_MOVED } from 'js/map2/events';
import { MapElement } from 'js/map2/map_element';

import { State, ViewerController, MAX_S2_ZOOM, MAX_ZXY_ZOOM, ZOOM_LEVEL } from './viewer_controller';

import './app.css';

function App({}: {}, state: State|undefined, updateState: (newState: State) => void) {
  if (!state) {
    state = {
      cellInput: '',
      cellType: 's2',
      level: ZOOM_LEVEL,
    };
  }

  const parameters = Object.fromEntries(new URLSearchParams(window.location.search).entries());
  const llz = {
    lat: floatCoalesce(parameters.lat, 46.859369),
    lng: floatCoalesce(parameters.lng, -121.747888),
    zoom: floatCoalesce(parameters.zoom, 12),
  };

  let deepestZoom;
  if (state.cellType === 's2') {
    deepestZoom = MAX_S2_ZOOM;
  } else if (state.cellType === 'z/x/y') {
    deepestZoom = MAX_ZXY_ZOOM;
  } else {
    checkExhaustive(state.cellType);
  }

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
        <Select
            className="bg-white text-xs"
            unboundEvents={{corgi: [[CHANGED, 'setCellType']]}}
            options={[
              {label: 's2', value: 's2'},
              {label: 'z/x/y', value: 'z/x/y'},
            ]}
        />
        <OutlinedInput
            className="bg-white text-xs"
            dense={true}
            forceValue={true}
            unboundEvents={{corgi: [[CHANGED, 'showCells']]}}
            value={state.cellInput}
        />
        <Select
            className="bg-white text-xs"
            unboundEvents={{corgi: [[CHANGED, 'setLevel']]}}
            options={[
              {label: 'zoom', value: String(ZOOM_LEVEL)},
              ...[...Array(deepestZoom).keys()].map(i => ({label: String(i), value: String(i)})),
            ]}
        />
      </div>
      {
        state.selectedS2
            ? <CellPopupS2 cell={state.selectedS2.cell} position={state.selectedS2.clickPx} />
            : <></>
      }
      {
        state.selectedZxy
            ? <CellPopupZxy
                llr={state.selectedZxy.llr}
                position={state.selectedZxy.clickPx}
                token={state.selectedZxy.token}
                xyz={state.selectedZxy.xyz}
            />
            : <></>
      }
    </div>
  </div>;
}

function CellPopupS2({cell, position}: {cell: S2CellId, position: [number, number]}) {
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
      <div>id: {cell.id().toString()}</div>
      <div>min: {cell.rangeMin().id().toString()}</div>
      <div>max: {cell.rangeMax().id().toString()}</div>
    </div>
  </>;
}

function CellPopupZxy({
  llr,
  position,
  token,
  xyz,
}: {
  llr: S2LatLngRect,
  position: [number, number];
  token: string;
  xyz: [number, number, number];
}) {
  const areaRad = llr.area();
  const center = llr.getCenter();
  const area =
      formatArea(
          areaRad
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
      <div className="font-bold">{token}</div>
      <div>area: {area.value} {area.unit}</div>
      <div>center: {center.latDegrees()},{center.lngDegrees()}</div>
      <div>world size: {Math.pow(2, xyz[2])}</div>
    </div>
  </>;
}

corgi.appendElement(checkExists(document.getElementById('root')), <App />);
