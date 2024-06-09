import { Future } from 'external/dev_april_corgi~/js/common/futures';
import * as corgi from 'external/dev_april_corgi~/js/corgi';
import { redirectTo } from 'external/dev_april_corgi~/js/server/ssr_aware';

import { Trail } from './models/types';

import { fetchData } from './data';
import { trailFromRaw } from './trails';

interface State {
  trail: Future<Trail>;
}

export function GoToTrailElement({trailId, parameters}: {
  trailId: string;
  parameters: {[key: string]: string};
}, inState: State|undefined, updateState: (newState: State) => void) {
  if (!inState) {
    inState = {
      trail: fetchData('trail', {trail_id: {numeric: trailId}}).then(trailFromRaw),
    };
  }
  const state = inState;

  if (state.trail.finished) {
    const trail = state.trail.value();
    redirectTo(`/trail/${trail.readableId}`);
    return <>
      <a href={`/trail/${trail.readableId}`}>
        Click here if you are not automatically redirected
      </a>
    </>;
  } else {
    state.trail.then(() => {
      updateState(state);
    });

    return <>Redirecting...</>;
  }
}
