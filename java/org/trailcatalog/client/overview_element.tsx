import * as corgi from 'js/corgi';

import { metersToMiles } from './common/math';
import { MAP_MOVED, PATH_SELECTED, Trail, TRAIL_SELECTED } from './map/events';
import { MapElement } from './map/map_element';

import { OverviewController, State } from './overview_controller';

const TRAIL_COUNT_MAX = 100;

export function OverviewElement(props: {}, state: State|undefined, updateState: (newState: State) => void) {
  if (!state) {
    state = {
      selectedTrail: undefined,
      showTrailsList: false,
      trails: [],
    };
  }

  const url = new URL(window.location.href);
  const lat = floatCoalesce(url.searchParams.get('lat'), 46.859369);
  const lng = floatCoalesce(url.searchParams.get('lng'), -121.747888);
  const zoom = floatCoalesce(url.searchParams.get('zoom'), 12);

  let trailDetails;
  if (state.selectedTrail) {
    trailDetails = <TrailDetailElement trail={state.selectedTrail} />;
  } else {
    trailDetails = <></>;
  }

  let filteredTrails;
  let hiddenTrailCount;
  if (state.trails.length > TRAIL_COUNT_MAX) {
    filteredTrails = state.trails.slice(0, TRAIL_COUNT_MAX);
    hiddenTrailCount = state.trails.length - TRAIL_COUNT_MAX;
  } else {
    filteredTrails = state.trails;
    hiddenTrailCount = 0;
  }

  return <>
    <div
        js={corgi.bind({
          controller: OverviewController,
          args: undefined,
          events: {
            corgi: [
              [MAP_MOVED, 'onMove'],
              [PATH_SELECTED, 'onPathSelected'],
              [TRAIL_SELECTED, 'onTrailSelected'],
            ],
          },
          state: [state, updateState],
        })}
    >
      <div className="align-middle bg-tc-200 leading-none">
        <FabricIcon
            name="List"
            className={
                (state.showTrailsList ? "bg-white" : "text-white")
                    + " p-2 text-3xl md:hidden"
            }
            unboundEvents={{click: 'toggleTrailsList'}}
        />
      </div>
      <div className="flex h-screen w-screen relative">
        <div className={
            (state.showTrailsList ? "" : "hidden md:block ")
                + "absolute bg-white inset-0 overflow-y-scroll p-4 z-10 md:relative md:w-96"
        }>
          <header className="flex gap-2 uppercase">
            <div className="basis-3/5">Name</div>
            <div className="basis-2/5">Distance</div>
          </header>
          {filteredTrails.map(trail => <TrailListElement trail={trail} />)}
          {hiddenTrailCount > 0 ? <footer>{hiddenTrailCount} hidden trails</footer> : ''}
        </div>
        <div className="relative">
          <MapElement lat={lat} lng={lng} zoom={zoom} />
          {trailDetails}
        </div>
      </div>
    </div>
  </>;
}

function TrailDetailElement({ trail }: { trail: Trail }) {
  return <div
      className="
          absolute
          bg-white
          left-1/2
          p-4
          rounded
          top-1/2
          -translate-x-1/2
          -translate-y-1/2
      "
  >
    <section className="flex space-x-2">
      <header className="font-bold font-lg grow text-tc-700">{trail.name}</header>
      <aside className="cursor-pointer" unboundEvents={{click: 'unselectTrail'}}>✕</aside>
    </section>
    <section className="flex">
      <section>
        <header className="font-medium text-tc-500 uppercase">
          Distance
        </header>
        <section>
          {metersToMiles(trail.lengthMeters).toFixed(1)} miles
        </section>
      </section>
    </section>
  </div>;
}

function TrailListElement({ trail }: { trail: Trail }) {
  return <div>
    <header
        className="border-b cursor-pointer flex gap-2 py-2"
        data-trail-id={trail.id}
        unboundEvents={{
          mouseover: 'highlightTrail',
          mouseout: 'unhighlightTrail',
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

type FabricIconName = 'List';

function FabricIcon({
  name,
  className,
  ...props
}: {name: FabricIconName} & corgi.Properties<HTMLElement>) {
  return <i className={`ms-Icon ms-Icon--${name} ${className}`} {...props} />;
}
