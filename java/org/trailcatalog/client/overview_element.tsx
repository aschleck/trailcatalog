import * as corgi from 'js/corgi';

import { Vec2 } from './common/types';
import { DATA_CHANGED, HOVER_CHANGED, MAP_MOVED, SELECTION_CHANGED } from './map/events';
import { MapElement } from './map/map_element';
import { Path, Trail } from './models/types';

import { OverviewController, State } from './overview_controller';
import { TrailListItem } from './trail_list';
import { TrailPopup } from './trail_popup';
import { ViewportLayoutElement } from './viewport_layout_element';

const TRAIL_COUNT_MAX = 100;

export function OverviewElement(props: {}, state: State|undefined, updateState: (newState: State) => void) {
  if (!state) {
    state = {
      hovering: undefined,
      nearbyTrails: [],
      selectedCardPosition: [0, 0],
      selectedTrails: [],
    };
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

  const nearby = state.nearbyTrails ?? [];
  let filteredTrails;
  let hiddenTrailCount;
  if (nearby.length > TRAIL_COUNT_MAX) {
    filteredTrails = nearby.slice(0, TRAIL_COUNT_MAX);
    hiddenTrailCount = nearby.length - TRAIL_COUNT_MAX;
  } else {
    filteredTrails = nearby;
    hiddenTrailCount = 0;
  }

  const trailSidebar = <>
    <header className="font-bold font-header text-xl px-3 pt-2">
      Nearby trails
    </header>
    {filteredTrails.map(trail =>
        <TrailListItem
            highlight={state?.hovering?.id === trail.id}
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
          overlay={{content: trailDetails}}
          sidebarContent={trailSidebar}
      />
    </div>
  </>;
}

