import { Controller, Response } from 'js/corgi/controller';
import { EmptyDeps } from 'js/corgi/deps';

import { Trail } from './models/types';

import { fetchData } from './data';
import { trailFromRaw } from './trails';

interface Args {
  trailId: string;
}

export interface State {
  trail?: Trail;
}

export class GoToTrailController extends Controller<Args, EmptyDeps, HTMLElement, State> {

  constructor(response: Response<GoToTrailController>) {
    super(response);

    const trailId = response.args.trailId;
    if (!this.state.trail) {
      fetchData('trail', {trail_id: {numeric: trailId}}).then(raw => {
        const trail = trailFromRaw(raw);
        this.updateState({
          ...this.state,
          trail,
        });
      });
    }
  }
}

