import * as corgi from 'js/corgi';
import { checkExists } from 'js/common/asserts';

import { decodeBase64 } from './common/base64';
import { latLngFromBase64E7 } from './common/data';
import { formatDistance, formatHeight } from './common/formatters';
import { initialData } from './data';
import { Boundary, Trail } from './models/types';

import { BoundaryCrumbs } from './boundary_crumbs';
import { DataResponses } from './data';
import { MapElement } from './map/map_element';
import { Header } from './page';
import { TrailDetailController, State } from './trail_detail_controller';
import { containingBoundariesFromRaw, pathProfilesInTrailFromRaw, trailFromRaw } from './trails';

export function TrailDetailElement({trailId}: {
  trailId: string;
}, state: State|undefined, updateState: (newState: State) => void) {
  if (!state) {
    const rawTrail = initialData('trail', {id: trailId});
    let trail;
    if (rawTrail) {
      trail = trailFromRaw(rawTrail);
    }

    const rawContainingBoundaries = initialData('boundaries_containing_trail', {trail_id: trailId});
    let containingBoundaries;
    if (rawContainingBoundaries) {
      containingBoundaries = containingBoundariesFromRaw(rawContainingBoundaries);
    }

    const rawPathProfiles = initialData('path_profiles_in_trail', {trail_id: trailId});
    let pathProfiles;
    if (rawPathProfiles) {
      pathProfiles = pathProfilesInTrailFromRaw(rawPathProfiles);
    }

    state = {
      containingBoundaries,
      pathProfiles,
      trail,
    };
  }

  let parsedId;
  try {
    parsedId = BigInt(trailId);
  } catch {
    return <>Invalid trail ID {trailId}</>;
  }

  return <>
    <div className="flex flex-col h-full items-center">
      <Header />
      <div
          js={corgi.bind({
            controller: TrailDetailController,
            args: {trailId: parsedId},
            events: {
              render: 'wakeup',
            },
            key: trailId,
            state: [state, updateState],
          })}
          className="h-full max-w-6xl px-4 my-8 w-full"
      >
        {state.containingBoundaries && state.pathProfiles && state.trail
            ? <Content
                containingBoundaries={state.containingBoundaries}
                pathProfiles={state.pathProfiles}
                trail={state.trail}
            />
            : "Loading..."
        }
      </div>
    </div>
  </>;
}

function Content(state: Required<State>) {
  const {containingBoundaries, pathProfiles, trail} = state;
  return [
    <header className="font-bold font-sans text-3xl">
      {trail.name}
    </header>,
    <aside>
      <BoundaryCrumbs boundaries={containingBoundaries} />
    </aside>,
    <MapElement
        active={{trails: [trail]}}
        camera={trail.bound}
        className="my-8"
        height="h-[32rem]"
        interactive={false}
    />,
    <ElevationGraph {...state} />,
  ];
}

function ElevationGraph({pathProfiles, trail}: Required<State>) {
  const resolutionHeight = 300;
  const resolutionWidth = 1200;
  let min = Number.MAX_VALUE;
  let max = Number.MIN_VALUE;
  let length = 0;
  const points: Array<[number, number]> = [];
  const process = (granularity: number, sample: number) => {
    points.push([length, sample]);
    min = Math.min(min, sample);
    max = Math.max(max, sample);
    length += granularity;
  };
  for (let i = 0; i < trail.paths.length; ++i) {
    const path = trail.paths[i];
    const profile = checkExists(pathProfiles.get(path & ~1n));
    const samples = profile.samples_meters;
    const offset = i === 0 ? 0 : 1;
    if ((path & 1n) === 0n) {
      for (let j = offset; j < samples.length; ++j) {
        process(profile.granularity_meters, samples[j]);
      }
    } else {
      for (let j = samples.length - 1 - offset; j >= 0; --j) {
        process(profile.granularity_meters, samples[j]);
      }
    }
  }
  const inverseHeight = resolutionHeight / (max - min);
  const inverseLength = resolutionWidth / length;
  const pointsString = points.map(([x, y]) => {
    const fx = Math.floor(x * inverseLength);
    const fy = Math.floor((max - y) * inverseHeight);
    return `${fx},${fy}`;
  }).join(" ");
  return <>
    <svg viewBox={`0 0 ${resolutionWidth} ${resolutionHeight}`}>
      <polyline fill="none" points={pointsString} stroke="black" stroke_width="3" />
    </svg>
  </>;
}
