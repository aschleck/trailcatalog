import { floatCoalesce } from 'js/common/math';
import * as corgi from 'js/corgi';

import { MAP_MOVED } from 'js/map/events';
import { MapElement } from 'js/map/map_element';

import { State, ViewerController } from './viewer_controller';

export function OverviewElement(
  {parameters}: {parameters: {[key: string]: string};},
  state: State|undefined,
  updateState: (newState: State) => void,
) {
  if (!state) {
    state = {};
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
          copyright={<Copyright />}
          ref="map"
      />
    </div>
  </>;
}

function Copyright() {
  return <>
    {'Maps ©'}
    <a
        className="pointer-events-auto"
        href="https://www.maptiler.com/copyright/"
        target="_blank">
      MapTiler
    </a>
    {', ©'}
    <a
        className="pointer-events-auto"
        href="https://www.openstreetmap.org/copyright"
        target="_blank">
      OpenStreetMap contributors
    </a>
    {', ©'}
    <a
        className="pointer-events-auto"
        href="/citations"
        target="_blank">
      trails.lat
    </a>
  </>;
}
