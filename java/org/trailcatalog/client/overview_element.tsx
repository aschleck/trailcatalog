import * as corgi from 'js/corgi';

import { MAP_MOVED } from './map/events';
import { MapElement } from './map/map_element';

import { OverviewController, State } from './overview_controller';

export function OverviewElement(props: {}, state: State|undefined, updateState: (newState: State) => void) {
  if (!state) {
    state = {count: 1};
  }

  const url = new URL(window.location.href);
  const lat = floatCoalesce(url.searchParams.get('lat'), 46.859369);
  const lng = floatCoalesce(url.searchParams.get('lng'), -121.747888);
  const zoom = floatCoalesce(url.searchParams.get('zoom'), 12);

  return <>
    <div
        js={corgi.bind({
          controller: OverviewController,
          args: undefined,
          events: {
            corgi: [
              [MAP_MOVED, 'onMove'],
            ],
          },
          state: [state, updateState],
        })}
        className="flex h-screen w-screen"
    >
      <div className="w-48">
        Sidebar {state.count}
      </div>
      <MapElement lat={lat} lng={lng} zoom={zoom} />
    </div>
  </>;
};

function floatCoalesce(...numbers: Array<string|number|null>): number {
  for (const x of numbers) {
    if (x == undefined || x === null) {
      continue;
    }
    const n = Number(x);
    if (!isNaN(n)) {
      return n;
    }
  }
  throw new Error('No valid floats');
}
