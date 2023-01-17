import { checkExists } from 'js/common/asserts';
import * as corgi from 'js/corgi';
import { FlatButton } from 'js/dino/button';
import { ACTION } from 'js/dino/events';
import { FabricIcon, FabricIconName } from 'js/dino/fabric';

import { formatDistance, formatHeight } from './common/formatters';
import { SELECTION_CHANGED } from './map/events';
import { MapElement } from './map/map_element';
import { Boundary, Trail } from './models/types';

import { BoundaryCrumbs } from './boundary_crumbs';
import { BoundaryDetailController, boundaryFromRaw, containingBoundariesFromRaw, LoadingController, State, trailsInBoundaryFromRaw } from './boundary_detail_controller';
import { initialData } from './data';
import { Header } from './page';
import { setTitle } from './title';
import { TrailPopup } from './trail_popup';

export function BoundaryDetailElement({boundaryId}: {
  boundaryId: string;
}, state: State|undefined, updateState: (newState: State) => void) {
  if (!state || boundaryId !== state.boundaryId) {
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
      boundaryId,
      containingBoundaries,
      selected: [],
      selectedCardPosition: [-1, -1],
			trailsInBoundary,
    };
  }

  setTitle(state.boundary?.name);

  return <>
    <div className="flex flex-col h-full items-center">
      <Header />
      {state.boundary && state.containingBoundaries && state.trailsInBoundary
        ? <Content boundaryId={boundaryId} state={state} updateState={updateState} />
        : <Loading boundaryId={boundaryId} state={state} updateState={updateState} />
      }
    </div>
  </>;
}

function Loading({boundaryId, state, updateState}: {
  boundaryId: string,
  state: State,
  updateState: (newState: State) => void,
}) {
  return <>
    <div
        js={corgi.bind({
          controller: LoadingController,
          events: {
            render: 'wakeup',
          },
          state: [state, updateState],
        })}
        className="h-full max-w-6xl px-4 my-8 w-full"
    >
      Loading...
    </div>
  </>;
}

function Content({boundaryId, state, updateState}: {
  boundaryId: string,
  state: State,
  updateState: (newState: State) => void,
}) {
  const containingBoundaries = checkExists(state.containingBoundaries);
  const boundary = checkExists(state.boundary);
  const trailsInBoundary = checkExists(state.trailsInBoundary);

  let trailDetails;
  if (state.selected.length > 0) {
    trailDetails =
        <TrailPopup
            items={state.selected}
            position={state.selectedCardPosition}
        />;
  } else {
    trailDetails = <></>;
  }

  return <>
    <div
        js={corgi.bind({
          controller: BoundaryDetailController,
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
      <header className="flex gap-2 items-center">
        <div unboundEvents={{corgi: [[ACTION, 'goBack']]}}>
          <FlatButton className="-m-2" icon="ChromeBack" />
        </div>
        <span className="font-bold font-sans text-3xl">
          {boundary.name}
        </span>
      </header>
      <aside className="flex flex-wrap gap-2 mt-2 text-tc-gray-400">
        <BoundaryCrumbs boundaries={containingBoundaries} />
        •
        <div>
          <a href={`https://www.openstreetmap.org/relation/${boundary.sourceRelation}`}>
            <img
                alt="OpenStreetMap logo"
                className="h-[1em] inline-block mr-1"
                src="/static/images/icons/osm-logo.svg"
            />
            Relation {boundary.sourceRelation}
          </a>
        </div>
      </aside>
      <div className="relative">
        <MapElement
            camera={boundary.bound}
            className="my-8"
            height="h-[32rem]"
            overlays={{polygon: boundary.polygon}}
            ref="map"
        />
        <div className="absolute flex flex-col gap-2 right-2 top-2">
          <div unboundEvents={{corgi: [[ACTION, 'zoomToFit']]}}>
            <FlatButton ariaLabel="Zoom to boundary" className="bg-white" icon="ZoomToFit" />
          </div>
          <div unboundEvents={{corgi: [[ACTION, 'browseMap']]}}>
            <FlatButton ariaLabel="Browse the map" className="bg-white" icon="ScaleVolume" />
          </div>
        </div>
        {trailDetails ?? <></>}
      </div>
      <div className="flex flex-wrap gap-4">
        {
          trailsInBoundary.map(t => <>
            <TrailBlock containingBoundaries={containingBoundaries} trail={t} />
          </>)
        }
      </div>
    </div>
  </>;
}

function TrailBlock({containingBoundaries, trail}: {
  containingBoundaries: Boundary[];
  trail: Trail;
}) {
  const distance = formatDistance(trail.lengthMeters);
  const elevationDown = formatHeight(trail.elevationDownMeters);
  const elevationUp = formatHeight(trail.elevationUpMeters);

  return <>
    <div
        className={
          'block border-2 border-tc-gray-200 flex rounded-lg w-[calc(100%_/_3_-_0.67rem)]'
        }
    >
      <div className="bg-tc-gray-100 h-32 shrink-0 w-32" />
      <div className="flex flex-col grow mx-5 my-2">
        <a className="font-semibold" href={`/goto/trail/${trail.id}`}>
          {trail.name}
        </a>
        <section className="grow text-sm text-tc-gray-400">
          <BoundaryCrumbs boundaries={containingBoundaries} />
        </section>
        <section className="self-end space-x-2 text-sm">
          <TrailNumericCrumb {...distance} />
          <TrailNumericCrumb {...elevationUp} />
        </section>
      </div>
    </div>
  </>;
}

function TrailNumericCrumb({value, unit}: {value: string; unit: string}) {
  return <>
    <span>
      <span className="font-bold">{value}</span>
      {' '}
      <span className="text-tc-gray-400">{unit}</span>
    </span>
  </>;
}
