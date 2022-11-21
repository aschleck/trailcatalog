import * as corgi from 'js/corgi';
import { checkExists } from 'js/common/asserts';

import { decodeBase64 } from './common/base64';
import { latLngFromBase64E7 } from './common/data';
import { formatDistance, formatHeight } from './common/formatters';
import { LatLng } from './common/types';
import { initialData } from './data';
import { Boundary, Trail } from './models/types';

import { BoundaryCrumbs } from './boundary_crumbs';
import { DataResponses } from './data';
import { MapElement } from './map/map_element';
import { Header } from './page';
import { calculateGraph, TrailDetailController, State } from './trail_detail_controller';
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

    let elevation;
    if (pathProfiles && trail) {
      elevation = calculateGraph(pathProfiles, trail);
    }

    state = {
      containingBoundaries,
      elevation,
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
        {state.containingBoundaries && state.elevation && state.pathProfiles && state.trail
            ? <Content
                containingBoundaries={state.containingBoundaries}
                elevation={state.elevation}
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
  const distance = formatDistance(trail.lengthMeters);
  const elevationUp = formatHeight(trail.elevationUpMeters);
  return [
    <header className="font-bold font-sans text-3xl">
      {trail.name}
    </header>,
    <aside>
      <BoundaryCrumbs boundaries={containingBoundaries} />
    </aside>,
    <aside>
      {distance.value} {distance.unit}, {elevationUp.value} {elevationUp.unit}
    </aside>,
    <MapElement
        active={{trails: [trail]}}
        camera={trail.bound}
        className="my-8"
        height="h-[32rem]"
        interactive={false}
        overlays={{point: state.elevation.cursor}}
    />,
    <ElevationGraph {...state} />,
  ];
}

function ElevationGraph({elevation}: Required<State>) {
  return <>
    <svg
        unboundEvents={{
          'pointermove': 'moveElevationCursor',
        }}
        viewBox={`0 0 ${elevation.resolution[0]} ${elevation.resolution[1]}`}>
      <polyline fill="none" points={elevation.heights} stroke="black" stroke_width="3" />
    </svg>
  </>;
}
