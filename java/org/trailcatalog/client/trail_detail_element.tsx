import * as corgi from 'js/corgi';

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
import { containingBoundariesFromRaw, trailFromRaw } from './trails';

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

    state = {
      containingBoundaries,
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
                trail={state.trail}
            />
            : "Loading..."
        }
      </div>
    </div>
  </>;
}

function Content({containingBoundaries, trail}: {
  containingBoundaries: Boundary[],
  trail: Trail,
}) {
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
    />
  ];
}
