import { checkExists } from 'external/dev_april_corgi+/js/common/asserts';
import * as corgi from 'external/dev_april_corgi+/js/corgi';
import { ACTION } from 'external/dev_april_corgi+/js/emu/events';
import { setCanonicalPath } from 'external/dev_april_corgi+/js/server/ssr_aware';

import { FlatButton, OutlinedButton } from 'js/dino/button';
import { FluentIcon, FluentIconName } from 'js/dino/fluent';
import { CLICKED, ZOOMED } from 'js/map/events';
import { MapElement } from 'js/map/map_element';

import { formatCount, formatDistance, formatHeight, getUnitSystem } from 'js/units/formatters';
import { SELECTION_CHANGED } from './map/events';
import { Boundary, getTrailTypeLabel, SOURCE_LABELS, Trail } from './models/types';

import { BoundaryCrumbs } from './boundary_crumbs';
import { BoundaryDetailController, boundaryFromRaw, State, trailsInBoundaryFromRaw } from './boundary_detail_controller';
import { fetchData, getLoadStatus } from './data';
import { ErrorElement } from './error_element';
import { setDescription, setTitle } from './head';
import { Header } from './page';
import { getTrailHref } from './routes';
import { containingBoundariesFromRaw } from './trails';
import { TrailPopup } from './trail_popup';

export function BoundaryDetailElement({boundaryId, parameters}: {
  boundaryId: string;
  parameters: {[key: string]: string};
}, inState: State|undefined, updateState: (newState: State) => void) {
  if (!inState || boundaryId !== inState.boundaryId) {
    inState = {
      boundary:
          fetchData('boundary', {boundary_id: {readable: boundaryId}}).then(boundaryFromRaw),
      boundaryId,
      containingBoundaries:
          fetchData('boundaries_containing_boundary', {child_id: {readable: boundaryId}})
              .then(containingBoundariesFromRaw),
      layers: [],
      selected: [],
      selectedCardPosition: [-1, -1],
			trailsInBoundary:
          fetchData('trails_in_boundary', {boundary_id: {readable: boundaryId}})
              .then(trailsInBoundaryFromRaw),
    };
  }
  const state = inState;

  setTitle(
      state.boundary.finished && state.boundary.ok ? state.boundary.value().name : undefined);
  setDescription(
      state.boundary.finished && state.boundary.ok
          && state.trailsInBoundary.finished && state.trailsInBoundary.ok
          ? describeBoundary(state.boundary.value(), state.trailsInBoundary.value())
          : undefined);
  setCanonicalPath(`/boundary/${boundaryId}`);

  const futures = [
    state.boundary,
    state.containingBoundaries,
    state.trailsInBoundary,
  ];
  const status = getLoadStatus(futures, () => { updateState(state); });

  return <>
    <div className="flex flex-col h-full items-center">
      <Header />
      {status === 'ready'
        ? <Content boundaryId={boundaryId} state={state} updateState={updateState} />
        : status === 'loading' ? 'Loading...' : <ErrorElement statusCode={status} />
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
        <span className="font-bold font-sans text-3xl" translate="no">
          {boundary.name}
        </span>
      </header>
      <aside className="flex flex-wrap gap-2 items-center mt-2 text-tc-gray-400">
        <div className="text-black" unboundEvents={{corgi: [[ACTION, 'browseMap']]}}>
          <OutlinedButton dense={true} icon="Map" label="Browse map" />
        </div>
        <BoundaryCrumbs boundaries={containingBoundaries} name={boundary.name} />
        •
        <div>
          <a
              href={`https://www.openstreetmap.org/${boundary.source.type}/${boundary.source.id}`}
              target="_blank"
          >
            <img
                alt="OpenStreetMap logo"
                className="h-4 inline-block mr-1"
                src="/static/images/icons/osm-logo.svg"
            />
            {SOURCE_LABELS[boundary.source.type]} {boundary.source.id}
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
            <FlatButton
                ariaLabel="Recenter boundary"
                className="bg-white"
                icon="ZoomFit"
                title="Recenter boundary"
            />
          </div>
          <div unboundEvents={{corgi: [[ACTION, 'browseMap']]}}>
            <FlatButton
                ariaLabel="Browse the map"
                className="bg-white"
                icon="ArrowExpand"
                title="Browse the map"
            />
          </div>
        </div>
        {trailDetails ?? <></>}
      </div>
      <div className="my-4">
        Don't see a trail you want to hike? Map your own route at
        {' '}
        <a className="underline" href={`https://trails.lat/?boundary=${boundary.id}`}>
          trails.lat
        </a>
      </div>
      <div className="my-4">
        <span className="font-bold text-3xl">
          {formatCount(trailsInBoundary.length)}
        </span>
        {' '}
        trails
      </div>
      <table className="border rounded table-auto my-4 w-full">
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

// Names the longest trails because trails_in_boundary sorts by length.
function describeBoundary(boundary: Boundary, trails: Trail[]): string|undefined {
  let which;
  if (trails.length === 0) {
    return undefined;
  } else if (trails.length === 1) {
    which = describeTrailFully(trails[0]);
  } else if (trails.length === 2) {
    which = `${describeTrailFully(trails[0])} and ${describeTrailFully(trails[1])}`;
  } else {
    const rest = trails.length - 2;
    which =
        `${describeTrailBriefly(trails[0])}, ${describeTrailBriefly(trails[1])}, and `
            + `${formatCount(rest)} more ${rest === 1 ? 'trail' : 'trails'}`;
  }
  return `${which} in ${boundary.name}`;
}

function describeTrailBriefly(trail: Trail): string {
  if (trail.lengthMeters < 0) {
    return trail.name;
  }
  const distance = formatDistance(trail.lengthMeters);
  return `${trail.name} (${distance.value} ${distance.unit})`;
}

function describeTrailFully(trail: Trail): string {
  const facts = [];
  const label = getTrailTypeLabel(trail.type).toLowerCase();
  if (label !== 'trail') {
    facts.push(label);
  }
  if (trail.lengthMeters >= 0) {
    const distance = formatDistance(trail.lengthMeters);
    const ascent = formatHeight(trail.elevationUpMeters);
    facts.push(`${distance.value} ${distance.unit}`, `${ascent.value} ${ascent.unit} up`);
  }
  return facts.length > 0 ? `${trail.name} (${facts.join(', ')})` : trail.name;
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
        <a href={getTrailHref(trail)} translate="no">
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
