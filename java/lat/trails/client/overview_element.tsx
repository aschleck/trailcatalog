import { floatCoalesce } from 'js/common/math';
import * as corgi from 'js/corgi';
import { Checkbox } from 'js/emu/checkbox';
import { ACTION } from 'js/emu/events';
import { MAP_MOVED } from 'js/map2/events';
import { MapElement } from 'js/map2/map_element';

import { LayerState, State, ViewerController } from './viewer_controller';

export function OverviewElement(
  {parameters}: {parameters: {[key: string]: string};},
  state: State|undefined,
  updateState: (newState: State) => void,
) {
  if (!state) {
    state = {
      layers: [],
    };
  }

  let camera = undefined;
  if (!parameters._used) {
    parameters._used = "true";
    camera = {
      lat: floatCoalesce(parameters.lat, 46.859369),
      lng: floatCoalesce(parameters.lng, -121.747888),
      zoom: floatCoalesce(parameters.zoom, 12),
    };
  }

  return <>
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
          camera={camera}
          ref="map"
      />
      <Rail>
        <Layers layers={state.layers} />
      </Rail>
    </div>
  </>;
}

function Rail({children}: {children?: corgi.VElementOrPrimitive}) {
  return <>
    <div className="
        absolute
        bg-gray-900
        border
        border-gray-900
        left-4
        p-1
        rounded
        text-white
        top-4
        ">
      {children}
    </div>
  </>;
}

function Layers({layers}: {layers: LayerState[];}) {
  const reversed = [];
  for (let i = layers.length - 1; i >= 0; --i) {
    reversed.push(layers[i]);
  }
  return <>
    <details>
      <summary>Layers</summary>
      <ul
          unboundEvents={{
            corgi: [
              [ACTION, 'setLayerVisible'],
            ],
          }}
      >
        {reversed.map(l => <>
          <li>
            <Checkbox ariaLabel={l.name} checked={l.enabled}>
              {l.name}
            </Checkbox>
          </li>
        </>)}
      </ul>
    </details>
  </>;
}

function Logo() {
  return <>
    <img
        alt="An illustration of a cat looking at the moon"
        className="w-72"
        src="/static/cat_moon.webp" />
  </>;
}
