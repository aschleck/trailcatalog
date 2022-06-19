import * as corgi from 'js/corgi';

import { initialData } from './common/ssr_aware';
import { Trail } from './models/types';

import { TrailOverviewController, State } from './trail_overview_controller';
import { ViewportLayoutElement } from './viewport_layout_element';

export function TrailOverviewElement({trailId}: {
  trailId: string;
}, state: State|undefined, updateState: (newState: State) => void) {
  if (!state) {
    const raw = initialData({
      type: 'trail',
      id: trailId,
    }) as {
      name: string;
      type: number;
      path_ids: string;
      center_degrees: {
        lat: number;
        lng: number;
      };
      length_meters: number;
    }|undefined;
    let trail;
    if (raw) {
      trail =
          new Trail(
              BigInt(trailId),
              raw.name,
              raw.type,
              {low: [0, 0], high: [0, 0]},
              [],
              [raw.center_degrees.lat, raw.center_degrees.lng],
              raw.length_meters);
    }
    state = {
      trail,
    };
  }

  let parsedId;
  try {
    parsedId = BigInt(trailId);
  } catch {
    return <>Invalid trail ID {trailId}</>;
  }

  let trailSidebar;
  if (state.trail) {
    trailSidebar = <TrailSidebar trail={state.trail} />;
  } else {
    trailSidebar = "Loading...";
  }

  return <>
    <div
        js={corgi.bind({
          controller: TrailOverviewController,
          args: {trailId: parsedId},
          events: {
            render: 'wakeup',
          },
          state: [state, updateState],
        })}
        className="flex flex-col h-full"
    >
      <ViewportLayoutElement
          sidebarContent={trailSidebar}
      />
    </div>
  </>;
}

function TrailSidebar({trail}: {trail: Trail}) {
  return <div>{trail.name}</div>;
}
