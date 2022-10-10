import * as corgi from 'js/corgi';

import { Vec2 } from './common/types';
import { DATA_CHANGED, HOVER_CHANGED, MAP_MOVED, SELECTION_CHANGED } from './map/events';
import { MapElement } from './map/map_element';
import { Path, Trail } from './models/types';

import { OverviewController, State } from './overview_controller';
import { TrailSidebar } from './trail_list';
import { TrailPopup } from './trail_popup';
import { ViewportLayoutElement } from './viewport_layout_element';

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
          sidebarContent={
            <TrailSidebar
                hovering={state?.hovering}
                nearby={state.nearbyTrails ?? []}
            />
          }
      />
    </div>
  </>;
}

