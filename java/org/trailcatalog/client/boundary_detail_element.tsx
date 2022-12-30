import { checkExists } from 'js/common/asserts';
import * as corgi from 'js/corgi';

import { SELECTION_CHANGED } from './map/events';
import { MapElement } from './map/map_element';

import { BoundaryCrumbs } from './boundary_crumbs';
import { BoundaryDetailController, boundaryFromRaw, containingBoundariesFromRaw, State, trailsInBoundaryFromRaw } from './boundary_detail_controller';
import { initialData } from './data';
import { Header } from './page';
import { setTitle } from './title';
import { TrailPopup } from './trail_popup';

export function BoundaryDetailElement({boundaryId}: {
  boundaryId: string;
}, state: State|undefined, updateState: (newState: State) => void) {
  if (!state) {
    const rawBoundary = initialData('boundary', {id: boundaryId});
    let boundary;
    if (rawBoundary) {
      boundary = boundaryFromRaw(rawBoundary);
    }

    const rawContainingBoundaries = initialData('boundaries_containing_boundary', {child_id: boundaryId});
    let containingBoundaries;
    if (rawContainingBoundaries) {
      containingBoundaries = containingBoundariesFromRaw(rawContainingBoundaries);
    }

    const rawTrailsInBoundary = initialData('trails_in_boundary', {boundary_id: boundaryId});
    let trailsInBoundary;
    if (rawTrailsInBoundary) {
      trailsInBoundary = trailsInBoundaryFromRaw(rawTrailsInBoundary);
    }

    state = {
      boundary,
      containingBoundaries,
      selectedCardPosition: [-1, -1],
      selectedTrails: [],
			trailsInBoundary,
    };
  }

  setTitle(state.boundary?.name);

  return <>
    <div className="flex flex-col h-full items-center">
      <Header />
      <div
          js={corgi.bind({
            controller: BoundaryDetailController,
            args: {boundaryId},
            events: {
              corgi: [
                [SELECTION_CHANGED, 'selectionChanged'],
              ],
              render: 'wakeup',
            },
            key: JSON.stringify(boundaryId),
            state: [state, updateState],
          })}
          className="h-full max-w-6xl px-4 my-8 w-full"
      >
        {state.containingBoundaries && state.boundary
            ? <Content {...state} />
            : "Loading..."
        }
      </div>
    </div>
  </>;
}

function Content(state: State) {
  const containingBoundaries = checkExists(state.containingBoundaries);
  const boundary = checkExists(state.boundary);
  const trailsInBoundary = checkExists(state.trailsInBoundary);

  let trailDetails;
  if (state.selectedTrails.length > 0) {
    trailDetails =
        <TrailPopup
            position={state.selectedCardPosition}
            trails={state.selectedTrails}
        />;
  } else {
    trailDetails = <></>;
  }

  return [
    <header className="font-bold font-sans text-3xl">
      {boundary.name}
    </header>,
    <aside>
      <BoundaryCrumbs boundaries={containingBoundaries} />
    </aside>,
    <div className="relative">
      <MapElement
          camera={boundary.bound}
          className="my-8"
          height="h-[32rem]"
          overlays={{polygon: state.boundary?.polygon}}
      />
      {trailDetails ?? <></>}
    </div>,
    <div className="flex flex-wrap">
      {
        trailsInBoundary.map(t => <>
          <a
              className="block border border-2 border-tc-gray-200 flex no-underline rounded"
              href={`/goto/trail/${t.id}`}
          >
            <div className="bg-tc-gray-100 h-32 w-32">
            </div>
            <div>
              {t.name}
            </div>
          </a>
        </>)
      }
    </div>,
  ];
}

