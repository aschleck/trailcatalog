import * as corgi from 'js/corgi';
import { checkExists } from 'js/common/asserts';

import { decodeBase64 } from './common/base64';
import { latLngFromBase64E7 } from './common/data';
import { formatDistance, formatHeight, shouldUseImperial } from './common/formatters';
import { metersToFeet } from './common/math';
import { LatLng } from './common/types';
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
      pinned: false,
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
        {state.containingBoundaries && state.trail
            ? <Content
                containingBoundaries={state.containingBoundaries}
                elevation={state.elevation}
                pathProfiles={state.pathProfiles}
                pinned={state.pinned}
                trail={state.trail}
            />
            : "Loading..."
        }
      </div>
    </div>
  </>;
}

function Content(state: State) {
  const containingBoundaries = checkExists(state.containingBoundaries);
  const trail = checkExists(state.trail);
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
        overlays={{point: state.elevation?.cursor}}
    />,
    state.elevation ? <ElevationGraph {...state} /> : <svg></svg>,
  ];
}

function ElevationGraph(state: State) {
  const elevation = checkExists(state.elevation);
  const [width, height] = elevation.resolution;

  const [minMeters, maxMeters] = elevation.extremes;
  let min;
  let max;
  if (shouldUseImperial()) {
    min = metersToFeet(minMeters);
    max = metersToFeet(maxMeters);
  } else {
    min = minMeters;
    max = maxMeters;
  }
  const gridEvery = Math.ceil((max - min) / 8 / 100) * 100;
  const gridLines = [];
  const gridText = [];
  const lowestGrid = Math.floor((min + gridEvery - 1) / gridEvery) * gridEvery;
  const highestGrid = Math.floor(max / gridEvery) * gridEvery;
  const scale = height / (max - min);
  for (let y = lowestGrid; y <= highestGrid; y += gridEvery) {
    const ry = height - scale * (y - min);
    gridLines.push(<line x1="0" y1={ry} x2={width} y2={ry} />);
    gridText.push(<text x="0" y={ry}>{y}</text>);
  }

  let indicator;
  if (elevation.cursorFraction !== undefined) {
    const x = elevation.cursorFraction * width;
    indicator = <line x1={x} y1="0" x2={x} y2={height} />;
  } else {
    indicator = <line x1="0" y1="0" x2="0" y2="0" />;
  }

  return <>
    <svg
        unboundEvents={{
          'pointermove': 'moveElevationCursor',
        }}
        viewBox={`0 0 ${width} ${height}`}>
      <g className="stroke-gray-300">
        <g style="stroke-dasharray: 8">
          {gridLines}
        </g>
        {gridText}
        {indicator}
      </g>
      <polyline fill="none" points={elevation.heights} stroke="black" stroke_width="2" />
    </svg>
  </>;
}
