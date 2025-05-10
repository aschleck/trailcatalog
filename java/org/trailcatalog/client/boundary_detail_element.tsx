import { checkExists } from 'external/dev_april_corgi+/js/common/asserts';
import * as corgi from 'external/dev_april_corgi+/js/corgi';
import { ACTION } from 'external/dev_april_corgi+/js/emu/events';

import { FlatButton, OutlinedButton } from 'js/dino/button';
import { FabricIcon, FabricIconName } from 'js/dino/fabric';
import { CLICKED, ZOOMED } from 'js/map/events';
import { MapElement } from 'js/map/map_element';

import { formatCount, formatDistance, formatHeight, getUnitSystem } from './common/formatters';
import { SELECTION_CHANGED } from './map/events';
import { Boundary, Trail } from './models/types';

import { BoundaryCrumbs } from './boundary_crumbs';
import { BoundaryDetailController, boundaryFromRaw, containingBoundariesFromRaw, State, trailsInBoundaryFromRaw } from './boundary_detail_controller';
import { fetchData } from './data';
import { Header } from './page';
import { setTitle } from './title';
import { TrailPopup } from './trail_popup';

export function BoundaryDetailElement({boundaryId, parameters}: {
  boundaryId: string;
  parameters: {[key: string]: string};
}, inState: State|undefined, updateState: (newState: State) => void) {
  if (!inState || boundaryId !== inState.boundaryId) {
    inState = {
      boundary: fetchData('boundary', {id: boundaryId}).then(boundaryFromRaw),
      boundaryId,
      containingBoundaries:
          fetchData('boundaries_containing_boundary', {child_id: boundaryId})
              .then(containingBoundariesFromRaw),
      layers: [],
      selected: [],
      selectedCardPosition: [-1, -1],
			trailsInBoundary:
          fetchData('trails_in_boundary', {boundary_id: boundaryId})
              .then(trailsInBoundaryFromRaw),
    };
  }
  const state = inState;

  setTitle(state.boundary.finished ? state.boundary.value().name : undefined);

  const futures = [
    state.boundary,
    state.containingBoundaries,
    state.trailsInBoundary,
  ];
  let ready;
  if (futures.filter(f => !f.finished).length > 0) {
    Promise.all(futures).then(() => {
      updateState(state);
    });
    ready = false;
  } else {
    ready = true;
  }

  return <>
    <div className="flex flex-col h-full items-center">
      <Header />
      {ready
        ? <Content boundaryId={boundaryId} state={state} updateState={updateState} />
        : 'Loading...'
      }
    </div>
  </>;
}

function Content({boundaryId, state, updateState}: {
  boundaryId: string,
  state: State,
  updateState: (newState: State) => void,
}) {
  const containingBoundaries = state.containingBoundaries.value();
  const boundary = state.boundary.value();
  const trailsInBoundary = state.trailsInBoundary.value();

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
          key: JSON.stringify(boundaryId),
          args: {
            overlays: {polygon: boundary.polygon},
            units: getUnitSystem(),
          },
          events: {
            corgi: [
              [CLICKED, 'selectionChanged'],
              [SELECTION_CHANGED, 'selectionChanged'],
              [ZOOMED, 'selectionChanged'],
            ],
            render: 'wakeup',
          },
          state: [state, updateState],
        })}
        className="h-full max-w-6xl px-4 my-8 w-full"
    >
      <header className="flex gap-2 items-center">
        <span className="font-bold font-sans text-3xl">
          {boundary.name}
        </span>
      </header>
      <aside className="flex flex-wrap gap-2 items-center mt-2 text-tc-gray-400">
        <div className="text-black" unboundEvents={{corgi: [[ACTION, 'browseMap']]}}>
          <OutlinedButton dense={true} icon="Nav2DMapView" label="Browse map" />
        </div>
        <BoundaryCrumbs boundaries={containingBoundaries} />
        •
        <div>
          <a
              href={`https://www.openstreetmap.org/relation/${boundary.sourceRelation}`}
              target="_blank"
          >
            <img
                alt="OpenStreetMap logo"
                className="h-4 inline-block mr-1"
                src="/static/images/icons/osm-logo.svg"
            />
            Relation {boundary.sourceRelation}
          </a>
        </div>
      </aside>
      <div className="my-8 relative">
        <MapElement
            camera={boundary.bound}
            height="h-[32rem]"
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
      <div className="mb-4 mt-8">
        <span className="font-bold text-3xl">
          {formatCount(trailsInBoundary.length)}
        </span>
        {' '}
        trails
      </div>
      <table className="border rounded table-auto w-full">
        <thead className="font-medium text-tc-gray-400 text-xs">
          <tr className="border">
            <th className="pb-2 pt-4 px-5">Name</th>
            <th className="pb-2 pt-4 px-5">Distance</th>
            <th className="pb-2 pt-4 px-5">Ascent</th>
            <th className="pb-2 pt-4 px-5">Descent</th>
            <th className="pb-2 pt-4 px-5">OpenStreetMap Relation</th>
          </tr>
        </thead>
        <tbody className="text-sm">
          {trailsInBoundary.map(t => <TrailRow trail={t} />)}
        </tbody>
      </table>
    </div>
  </>;
}

function TrailRow({trail}: {
  trail: Trail;
}) {
  const distance = formatDistance(trail.lengthMeters);
  const elevationDown = formatHeight(trail.elevationDownMeters);
  const elevationUp = formatHeight(trail.elevationUpMeters);

  return <>
    <tr className="border">
      <td className="px-5 py-4">
        <a href={`/goto/trail/${trail.id}`}>
          {trail.name}
        </a>
      </td>
      <td className="px-5 py-4"><TrailNumericCrumb {...distance} /></td>
      <td className="px-5 py-4"><TrailNumericCrumb {...elevationUp} /></td>
      <td className="px-5 py-4"><TrailNumericCrumb {...elevationDown} /></td>
      <td className="px-5 py-4">
        <a
            href={`https://www.openstreetmap.org/relation/${trail.sourceRelation}`}
            target="_blank"
        >
          <img
              alt="OpenStreetMap logo"
              className="h-4 inline-block mr-1"
              src="/static/images/icons/osm-logo.svg"
          />
          {trail.sourceRelation}
        </a>
      </td>
    </tr>
  </>;
}

function TrailNumericCrumb({value, unit}: {value: string; unit: string}) {
  return <>
    <span>
      <span>{value}</span>
      {' '}
      <span className="text-tc-gray-400 text-xs">{unit}</span>
    </span>
  </>;
}
