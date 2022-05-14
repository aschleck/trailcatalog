import * as corgi from 'js/corgi';

import { metersToMiles } from './common/math';
import { DATA_CHANGED, HOVER_CHANGED, MAP_MOVED, SELECTION_CHANGED } from './map/events';
import { MapElement } from './map/map_element';
import { Trail } from './models/types';

import { OverviewController, State } from './overview_controller';

const TRAIL_COUNT_MAX = 100;

export function OverviewElement({boundary}: {
  boundary?: string;
}, state: State|undefined, updateState: (newState: State) => void) {
  if (!state) {
    state = {
      hovering: undefined,
      selectedTrails: [],
      showTrailsList: false,
      trails: [],
    };
  }

  let parsedBoundary;
  if (boundary) {
    const parsed = Number.parseInt(boundary);
    if (isNaN(parsed)) {
      throw new Error(`Boundary ${boundary} is invalid`);
    } else {
      parsedBoundary = parsed;
    }
  }

  const url = new URL(window.location.href);
  const lat = floatCoalesce(url.searchParams.get('lat'), 46.859369);
  const lng = floatCoalesce(url.searchParams.get('lng'), -121.747888);
  const zoom = floatCoalesce(url.searchParams.get('zoom'), 12);

  let trailDetails;
  if (state.selectedTrails.length > 0) {
    trailDetails = <SelectedTrailsElement trails={state.selectedTrails} />;
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
              [DATA_CHANGED, 'onDataChange'],
              [HOVER_CHANGED, 'onHoverChanged'],
              [MAP_MOVED, 'onMove'],
              [SELECTION_CHANGED, 'onSelectionChanged'],
            ],
          },
          state: [state, updateState],
        })}
        className="flex flex-col h-full"
    >
      <div className="align-middle bg-tc-gray-200 leading-none">
        <FabricIcon
            name="List"
            className={
                (state.showTrailsList ? "bg-white" : "text-white")
                    + " p-2 text-3xl md:hidden"
            }
            unboundEvents={{click: 'toggleTrailsList'}}
        />
      </div>
      <div className="flex grow overflow-hidden relative">
        <div className={
            (state.showTrailsList ? "" : "hidden md:block ")
                + "absolute bg-white inset-0 max-h-full overflow-y-scroll z-10 md:relative md:w-80"
        }>
          <header className="flex gap-2 px-4 pt-2 uppercase">
            <div className="grow">Name</div>
            <div className="shrink-0 w-24">Distance</div>
          </header>
          {filteredTrails.map(trail =>
              <TrailListElement
                  highlight={state?.hovering === trail}
                  trail={trail}
              />
          )}
          {hiddenTrailCount > 0 ? <footer>{hiddenTrailCount} hidden trails</footer> : ''}
        </div>
        <div className="grow h-full relative">
          <MapElement camera={{lat, lng, zoom}} filter={{boundary: parsedBoundary}} />
          {trailDetails}
        </div>
      </div>
    </div>
  </>;
}

function SelectedTrailsElement({ trails }: { trails: Trail[] }) {
  return <div
      className="
          absolute
          bg-white
          left-1/2
          rounded
          top-1/2
          -translate-x-1/2
          -translate-y-1/2
      "
  >
    {trails.map(trail =>
      <section
          className="p-2 hover:bg-tc-gray-700"
          data-trail-id={trail.id}
          unboundEvents={{
            click: 'viewTrail',
          }}
      >
        <header className="font-bold font-lg grow">
          {trail.name}
        </header>
        <section>
          <span className="text-tc-gray-500">
            Distance:
          </span>
          <span>
            {metersToMiles(trail.lengthMeters).toFixed(1)} miles
          </span>
        </section>
      </section>
    )}
  </div>;
}

function TrailListElement({ highlight, trail }: { highlight: boolean, trail: Trail }) {
  return <section
      className="border-b cursor-pointer flex gap-2 group items-stretch pr-2"
      data-trail-id={trail.id}
      unboundEvents={{
        mouseover: 'highlightTrail',
        mouseout: 'unhighlightTrail',
      }}>
    <div className={
        (highlight ? 'bg-highlight ' : '') + 'w-2 group-hover:bg-highlight'
    }>
    </div>
    <div className="font-lg font-semibold grow py-2">{trail.name}</div>
    <div className="py-2 shrink-0 w-24">
      <span className="font-bold font-lg">
        {metersToMiles(trail.lengthMeters).toFixed(1)}
      </span>
      {' '}
      <span className="font-xs text-slate-400">miles</span>
    </div>
  </section>;
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
