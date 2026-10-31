import { checkExists } from 'external/dev_april_corgi+/js/common/asserts';
import { resolvedFuture } from 'external/dev_april_corgi+/js/common/futures';
import { floatCoalesce } from 'external/dev_april_corgi+/js/common/math';
import * as corgi from 'external/dev_april_corgi+/js/corgi';
import { ACTION } from 'external/dev_april_corgi+/js/emu/events';
import { setCanonicalPath } from 'external/dev_april_corgi+/js/server/ssr_aware';

import { FlatButton, OutlinedButton } from 'js/dino/button';
import { Checkbox } from 'js/dino/checkbox';
import { FluentIcon } from 'js/dino/fluent';
import { LatLngRect } from 'js/map/common/types';
import { CLICKED, DATA_CHANGED, MAP_MOVED, ZOOMED } from 'js/map/events';
import { MapElement } from 'js/map/map_element';

import { getUnitSystem } from 'js/units/formatters';
import { HOVER_CHANGED, SELECTION_CHANGED } from './map/events';
import { Trail, TrailSearchResult } from './models/types';

import { BoundaryCrumbs } from './boundary_crumbs';
import { boundaryFromRaw, trailsInBoundaryFromRaw } from './boundary_detail_controller';
import { fetchData, getLoadStatus } from './data';
import { ErrorElement } from './error_element';
import { Header } from './page';
import { searchTrailsFromRaw } from './search_controller';
import { LIMIT, SearchResultsOverviewController, State } from './search_results_overview_controller';
import { setTitle } from './title';
import { TrailSidebar } from './trail_list';
import { TrailPopup } from './trail_popup';

export function SearchResultsOverviewElement(
    {parameters}: {parameters: {[key: string]: string};},
    inState: State|undefined,
    updateState: (newState: State) => void) {
  const boundaryId = parameters.boundary ?? undefined;
  const query = parameters.query ?? undefined;

  setTitle(query);
  // The camera, query, and boundary parameters would otherwise make every search its own page.
  setCanonicalPath('/');

  if (!inState || boundaryId !== inState.boundaryId || query !== inState.searchQuery) {
    let boundary;
    let trailsInBoundary;
    let trailsInBoundaryIds;

    if (boundaryId) {
      boundary = fetchData('boundary', {boundary_id: {numeric: boundaryId}}).then(boundaryFromRaw);

      trailsInBoundary =
          fetchData('trails_in_boundary', {boundary_id: {numeric: boundaryId}})
              .then(trailsInBoundaryFromRaw);
      trailsInBoundaryIds = trailsInBoundary.then(raw => new Set(raw.map(t => t.id)));
    }

    let searchTrails;
    let searchTrailsIds;
    if (query) {
      searchTrails = fetchData('search_trails', {query, limit: LIMIT}).then(searchTrailsFromRaw);
      searchTrailsIds = searchTrails.then(raw => new Set(raw.map(t => t.id)));
    }

    inState = {
      blueDot: undefined,
      boundary,
      boundaryId,
      filterInBoundary: !!boundary,
      layers: [],
      mobileSidebarOpen: false,
      searchQuery: query,
      searchTrails,
      searchTrailsIds,
      trailsFilter: () => true,
      trailsInBoundary,
      trailsInBoundaryFilter: () => true,
      trailsInBoundaryIds,
      hovering: undefined,
      nearbyTrails: [],
      selected: [],
      selectedCardPosition: [-1, -1],
    };
  }
  const state = inState;

  const futures = [
    state.boundary ?? resolvedFuture(undefined),
    state.trailsInBoundary ?? resolvedFuture(undefined),
    state.trailsInBoundaryIds ?? resolvedFuture(undefined),
    state.searchTrails ?? resolvedFuture(undefined),
    state.searchTrailsIds ?? resolvedFuture(undefined),
  ];
  const status = getLoadStatus(futures, () => { updateState(state); });

  return <>
      {status === 'ready'
          ? <Content
              boundaryId={boundaryId}
              query={query}
              parameters={parameters}
              state={state}
              updateState={updateState} />
          : status === 'loading' ? 'Loading...' : <ErrorElement statusCode={status} />
      }
  </>;
}

function Content({
  boundaryId,
  query,
  parameters,
  state,
  updateState,
}: {
  boundaryId?: string;
  query?: string;
  parameters: {[key: string]: string};
  state: State;
  updateState: (newState: State) => void;
}) {
  const filter = state.filterInBoundary ? state.trailsInBoundaryFilter : state.trailsFilter;

  let filteredTrails: Array<Trail|TrailSearchResult> = [];
  let bound: LatLngRect|undefined;
  if (query) {
    if (state.searchTrails) {
      filteredTrails = state.searchTrails.value().filter(t => filter(t.id));
      if (filteredTrails.length > 0) {
        const bounds = filteredTrails.map(t => t.bound);
        bound = {
          low: [Math.min(...bounds.map(b => b.low[0])), Math.min(...bounds.map(b => b.low[1]))],
          high: [Math.max(...bounds.map(b => b.high[0])), Math.max(...bounds.map(b => b.high[1]))],
          brand: 'LatLngRect',
        };
      }
    }
  } else if (boundaryId) {
    if (state.boundary && state.trailsInBoundary) {
      bound = state.boundary.value().bound;
      if (state.filterInBoundary) {
        filteredTrails = state.trailsInBoundary.value();
      } else {
        filteredTrails = state.nearbyTrails;
      }
    }
  } else {
    filteredTrails = state.nearbyTrails;
  }

  // A URL camera is where the viewer last left the map, so it wins over fitting the results.
  const camera =
      parameters.lat !== undefined && parameters.lng !== undefined
          ? {
            lat: Number(parameters.lat),
            lng: Number(parameters.lng),
            zoom: floatCoalesce(parameters.zoom, 12),
          }
          : bound;

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
          controller: SearchResultsOverviewController,
          args: {
            boundaryId,
            filters: {
              trail: filter,
            },
            overlays: {
              blueDot: state.blueDot,
              polygon: state.boundary?.value().polygon,
            },
            query,
            units: getUnitSystem(),
          },
          events: {
            corgi: [
              [CLICKED, 'selectionChanged'],
              [DATA_CHANGED, 'onDataChange'],
              [HOVER_CHANGED, 'onHoverChanged'],
              [MAP_MOVED, 'onMove'],
              [SELECTION_CHANGED, 'selectionChanged'],
              [ZOOMED, 'selectionChanged'],
            ],
            render: 'wakeup',
          },
          key: `${boundaryId}&${query}`,
          state: [state, updateState],
        })}
        className="flex flex-col h-full"
    >
      <Header
          query={query}
          extra={
            <span
                unboundEvents={{
                  corgi: [
                    [ACTION, 'locateMe'],
                  ]
                }}
            >
              <OutlinedButton
                  icon="Record"
                  label="Locate me"
              />
            </span>
          }
      />
      <div className="flex grow overflow-hidden">
        <TrailSidebar
            hovering={state.hovering}
            mobileOpen={state.mobileSidebarOpen}
            nearby={filteredTrails}
        />
        <div className="grow h-full relative">
          {state.boundary ? <SearchFilter state={state} /> : ''}
          <MapElement
              camera={camera}
              ref="map"
          />
          {trailDetails}
        </div>
      </div>
    </div>
  </>;
}

function SearchFilter({state}: {state: State}) {
  const boundary = checkExists(state.boundary).value();
  const divider = <div className="bg-black-opaque-20 self-stretch w-px" />;
  return <>
    <aside
        className={
          'bg-tc-highlight-1 flex gap-2 px-2 items-center rounded text-black'
              + ' md:right-3 md:top-2 md:z-10 md:absolute'
        }
    >
      <a
          className="flex gap-2 items-center"
          href={`/boundary/${boundary.readableId}`}
      >
        <img
            aria-hidden="true"
            className="h-4"
            src="/static/images/icons/boundary-filled.svg" />
        {boundary.name}
      </a>

      <Checkbox
          className="
              cursor-pointer
              flex
              gap-2
              items-center"
          checked={state.filterInBoundary}
          label="Filter by boundary"
          unboundEvents={{
            change: 'toggleBoundaryFilter',
          }}
      />

      {divider}

      <span
          unboundEvents={{
            corgi: [
              [ACTION, 'clearBoundary'],
            ],
          }}
      >
        <FlatButton icon="Dismiss" />
      </span>
    </aside>
  </>;
}
