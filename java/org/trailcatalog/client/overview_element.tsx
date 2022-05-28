import * as corgi from 'js/corgi';

import { metersToMiles } from './common/math';
import { Vec2 } from './common/types';
import { DATA_CHANGED, HOVER_CHANGED, MAP_MOVED, SELECTION_CHANGED } from './map/events';
import { MapElement } from './map/map_element';
import { Path, Trail } from './models/types';

import { OverviewController, State } from './overview_controller';
import { ViewportLayoutElement } from './viewport_layout_element';

const TRAIL_COUNT_MAX = 100;

export function OverviewElement({boundary}: {
  boundary?: string;
}, state: State|undefined, updateState: (newState: State) => void) {
  if (!state) {
    state = {
      hovering: undefined,
      selectedCardPosition: [0, 0],
      selectedTrails: [],
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

  let trailDetails;
  if (state.selectedTrails.length > 0) {
    trailDetails =
        <SelectedTrailsElement
            position={state.selectedCardPosition}
            trails={state.selectedTrails}
        />;
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

  const trailSidebar = <>
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
  </>;

  return <>
    <div
        js={corgi.bind({
          controller: OverviewController,
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
      <ViewportLayoutElement
          filter={{boundary: parsedBoundary}}
          mapOverlay={trailDetails}
          sidebarContent={trailSidebar}
      />
    </div>
  </>;
}

function SelectedTrailsElement({ position, trails }: {
  position: Vec2,
  trails: Trail[],
}) {
  return <div
      className="
          absolute
          bg-white
          mb-4
          rounded
          -translate-x-1/2
          translate-y-[calc(-100%-0.75rem)]
      "
      style={`left: ${position[0]}px; top: ${position[1]}px`}
  >
    {trails.map(trail =>
      <section
          className="cursor-pointer p-2 hover:bg-tc-gray-700"
          data-trail-id={trail.id}
          unboundEvents={{
            click: 'viewTrail',
            mouseover: 'highlightTrail',
            mouseout: 'unhighlightTrail',
          }}
      >
        <header className="font-bold font-lg grow">
          {trail.name}
        </header>
        {[
          ['Distance:', `${metersToMiles(trail.lengthMeters).toFixed(1)} miles`],
          ['Relation ID:', trail.id],
        ].map(([label, content]) =>
          <section>
            <span className="text-tc-gray-500">
              {label}
            </span>
            <span>
              {content}
            </span>
          </section>
        )}
      </section>
    )}
  </div>;
}

function TrailListElement({ highlight, trail }: { highlight: boolean, trail: Trail }) {
  return <section
      className="border-b cursor-pointer flex gap-2 items-stretch pr-2"
      data-trail-id={trail.id}
      unboundEvents={{
        click: 'viewTrail',
        mouseover: 'highlightTrail',
        mouseout: 'unhighlightTrail',
      }}>
    <div className={
        (highlight ? 'bg-highlight ' : '') + 'w-2'
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

