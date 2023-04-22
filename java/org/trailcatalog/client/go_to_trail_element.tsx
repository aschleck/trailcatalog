import * as corgi from 'js/corgi';
import { redirectTo } from 'js/server/ssr_aware';

import { initialData } from './data';
import { GoToTrailController, State } from './go_to_trail_controller';
import { trailFromRaw } from './trails';

export function GoToTrailElement({trailId, parameters}: {
  trailId: string;
  parameters: {[key: string]: string};
}, state: State|undefined, updateState: (newState: State) => void) {
  if (!state) {
    const rawTrail = initialData('trail', {trail_id: {numeric: trailId}});
    let trail;
    if (rawTrail) {
      trail = trailFromRaw(rawTrail);
    }

    state = {
      trail,
    };
  }

  if (state.trail) {
    redirectTo(`/trail/${state.trail.readableId}`);
    return <>
      <a href={`/trail/${state.trail.readableId}`}>
        Click here if you are not automatically redirected
      </a>
    </>;
  } else {
    return <>
      <div
          js={corgi.bind({
            controller: GoToTrailController,
            args: {trailId},
            events: {
              render: 'wakeup',
            },
            state: [state, updateState],
          })}
      >
        Redirecting...
      </div>
    </>;
  }
}
