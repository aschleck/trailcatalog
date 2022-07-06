import * as corgi from 'js/corgi';

import { metersToMiles } from './common/math';
import { Vec2 } from './common/types';
import { HOVER_HEX_PALETTE } from './map/common/colors';
import { DATA_CHANGED, HOVER_CHANGED, MAP_MOVED, SELECTION_CHANGED } from './map/events';
import { MapElement } from './map/map_element';
import { Path, Trail } from './models/types';

import { OverviewController, State } from './overview_controller';
import { TrailPopup } from './trail_popup';
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
        <TrailPopup
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
    <header className="font-bold font-header text-xl px-3 pt-2">
      Nearby trails
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

function TrailListElement({ highlight, trail }: { highlight: boolean, trail: Trail }) {
  return <>
    <a
        className={
          'cursor-pointer flex gap-2 items-stretch pr-2'
              + (highlight ? ' bg-tc-gray-700' : '')
        }
        href={`/trail/${trail.id}`}
        data-trail-id={trail.id}
        unboundEvents={{
          click: 'viewTrail',
          mouseover: 'highlightTrail',
          mouseout: 'unhighlightTrail',
        }}>
      <div
          className="my-1 rounded-r-lg w-1"
          style={highlight ? `background-color: ${HOVER_HEX_PALETTE.stroke}` : ''}
      >
      </div>
      <div className="font-lg grow py-2">{trail.name}</div>
      <div className="py-2 shrink-0 w-24">
        <span className="font-lg">
          {metersToMiles(trail.lengthMeters).toFixed(1)}
        </span>
        {' '}
        <span className="font-xs text-tc-gray-400">miles</span>
      </div>
    </a>
  </>;
}

