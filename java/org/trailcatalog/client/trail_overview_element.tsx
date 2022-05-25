import * as corgi from 'js/corgi';

import { TrailOverviewController, State } from './trail_overview_controller';
import { ViewportLayoutElement } from './viewport_layout_element';

export function TrailOverviewElement({trailId}: {
  trailId: string;
}, state: State|undefined, updateState: (newState: State) => void) {
  if (!state) {
    state = {
      trail: undefined,
    };
  }

  let parsedId;
  try {
    parsedId = BigInt(trailId);
  } catch {
    return <>Invalid trail ID {trailId}</>;
  }

  const trailSidebar = <>{state.trail?.name} ({trailId})</>;

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

