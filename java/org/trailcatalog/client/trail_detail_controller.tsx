import { S2LatLng, S2Point } from 'java/org/trailcatalog/s2';
import { SimpleS2 } from 'java/org/trailcatalog/s2/SimpleS2';
import { checkExists } from 'js/common/asserts';
import { Controller, Response } from 'js/corgi/controller';
import { CorgiEvent } from 'js/corgi/events';

import { decodeBase64 } from './common/base64';
import { LittleEndianView } from './common/little_endian_view';
import { LatLng, Vec2 } from './common/types';
import { Boundary, ElevationProfile, Trail } from './models/types';

import { DataResponses, fetchData } from './data';
import { containingBoundariesFromRaw, pathProfilesInTrailFromRaw, trailFromRaw } from './trails';

interface Args {
  trailId: bigint;
}

export interface State {
  containingBoundaries?: Boundary[];
  elevation?: {
    cursor?: LatLng;
    cursorFraction?: number;
    heights: string;
    points: LatLng[];
    resolution: Vec2;
  }
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

  updateState(newState: State) {
    // Yikes!
    if (!(this.state.pathProfiles && this.state.trail)
        && (newState.pathProfiles && newState.trail)) {
      newState.elevation = calculateGraph(newState.pathProfiles, newState.trail);
    }
    super.updateState(newState);
  }

  moveElevationCursor(e: PointerEvent) {
    if (!this.state.elevation) {
      return;
    }

    const elevation = this.state.elevation;
    const bound = (e.currentTarget as Element).getBoundingClientRect();
    const fraction = (e.clientX - bound.x) / bound.width;
    // Not exactly accurate (points might be very close at the path edges) but I don't care.
    const point = elevation.points[Math.floor(fraction * elevation.points.length)];

    this.updateState({
      ...this.state,
      elevation: {
        ...elevation,
        cursor: point,
        cursorFraction: fraction,
      },
    });
  }
}

export function calculateGraph(pathProfiles: Map<bigint, ElevationProfile>, trail: Trail): {
  heights: string;
  points: LatLng[];
  resolution: Vec2;
} {
  const resolutionHeight = 300;
  const resolutionWidth = 1200;
  let min = Number.MAX_VALUE;
  let max = Number.MIN_VALUE;
  let length = 0;

  const heights: Vec2[] = [];
  const points: LatLng[] = [];
  let lastPoint: S2Point|undefined = undefined;
  const process = (latLng: LatLng, sample: number) => {
    points.push(latLng);
    heights.push([length, sample]);
    min = Math.min(min, sample);
    max = Math.max(max, sample);

    const thisPoint = S2LatLng.fromDegrees(latLng[0], latLng[1]).toPoint();
    if (lastPoint != null) {
      length += lastPoint.angle(thisPoint) * 6371010;
    }
    lastPoint = thisPoint;
  };
  for (let i = 0; i < trail.paths.length; ++i) {
    const path = trail.paths[i];
    const profile = checkExists(pathProfiles.get(path & ~1n));
    const latLngs = profile.latLngs;
    const samples = profile.samplesMeters;
    const offset = i === 0 ? 0 : 1;

    if ((path & 1n) === 0n) {
      for (let j = offset; j < samples.length; ++j) {
        process(latLngs[j], samples[j]);
      }
    } else {
      for (let j = samples.length - 1 - offset; j >= 0; --j) {
        process(latLngs[j], samples[j]);
      }
    }
  }

  const inverseHeight = resolutionHeight / (max - min);
  const inverseLength = resolutionWidth / length;
  const heightsString = heights.map(([x, y]) => {
    const fx = Math.floor(x * inverseLength);
    const fy = Math.floor((max - y) * inverseHeight);
    return `${fx},${fy}`;
  }).join(" ");
  return {
    heights: heightsString,
    points,
    resolution: [resolutionWidth, resolutionHeight],
  };
}

