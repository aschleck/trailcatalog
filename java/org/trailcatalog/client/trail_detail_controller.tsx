import { S2LatLng } from 'java/org/trailcatalog/s2';
import { Controller, Response } from 'js/corgi/controller';
import { CorgiEvent } from 'js/corgi/events';

import { Boundary, ElevationProfile, Trail } from './models/types';

import { DataResponses, fetchData } from './data';
import { containingBoundariesFromRaw, pathProfilesInTrailFromRaw, trailFromRaw } from './trails';

interface Args {
  trailId: bigint;
}

export interface State {
  containingBoundaries?: Boundary[];
  pathProfiles?: Map<bigint, ElevationProfile>;
  trail?: Trail;
}

type Deps = typeof TrailDetailController.deps;

export class TrailDetailController extends Controller<Args, Deps, HTMLElement, State> {

  static deps() {
    return {
      services: {
      },
    };
  }

  constructor(response: Response<TrailDetailController>) {
    super(response);

    const id = `${response.args.trailId}`;
    if (!this.state.trail) {
      fetchData('trail', {id}).then(raw => {
        this.updateState({
          ...this.state,
          trail: trailFromRaw(raw),
        });
      });
    }

    if (!this.state.containingBoundaries) {
      fetchData('boundaries_containing_trail', {trail_id: id}).then(raw => {
        this.updateState({
          ...this.state,
          containingBoundaries: containingBoundariesFromRaw(raw),
        });
      });
    }

    if (!this.state.pathProfiles) {
      fetchData('path_profiles_in_trail', {trail_id: id}).then(raw => {
        this.updateState({
          ...this.state,
          pathProfiles: pathProfilesInTrailFromRaw(raw),
        });
      });
    }
  }
}

