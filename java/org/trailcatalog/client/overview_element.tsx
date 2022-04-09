import * as corgi from 'js/corgi';

import { metersToMiles } from './common/math';
import { MAP_MOVED, Trail } from './map/events';
import { MapElement } from './map/map_element';

import { OverviewController, State } from './overview_controller';

export function OverviewElement(props: {}, state: State|undefined, updateState: (newState: State) => void) {
  if (!state) {
    state = {trails: []};
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
      <div className="overflow-scroll p-4 w-96">
        <header className="flex gap-2 uppercase">
          <div className="basis-3/5">Name</div>
          <div className="basis-2/5">Distance</div>
        </header>
        {state.trails.map(trail => <TrailElement trail={trail} />)}
      </div>
      <MapElement lat={lat} lng={lng} zoom={zoom} />
    </div>
  </>;
}

function TrailElement({ trail }: { trail: Trail }) {
  return <div>
    <header
        className="border-b cursor-pointer flex gap-2 py-2"
        data-trail-id={trail.id}
        unboundEvents={{
          mouseover: 'selectTrail',
          mouseout: 'unselectTrail',
        }}>
      <div className="basis-3/5 font-lg font-semibold">{trail.name}</div>
      <div className="basis-2/5">
        <span className="font-bold font-lg">
          {metersToMiles(trail.lengthMeters).toFixed(1)}
        </span>
        {' '}
        <span className="font-xs text-slate-400">miles</span>
      </div>
    </header>
  </div>;
}

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
