import { checkExists } from 'js/common/asserts';
import { floatCoalesce } from 'js/common/math';
import * as corgi from 'js/corgi';
import { FlatButton, OutlinedButton } from 'js/dino/button';
import { Checkbox } from 'js/dino/checkbox';
import { ACTION } from 'js/dino/events';
import { FabricIcon } from 'js/dino/fabric';
import { emptyLatLngRect } from 'js/map/common/types';
import { CLICKED, DATA_CHANGED, MAP_MOVED, ZOOMED } from 'js/map/events';
import { MapElement } from 'js/map/map_element';

import { HOVER_CHANGED, SELECTION_CHANGED } from './map/events';
import { Trail, TrailSearchResult } from './models/types';

import { BoundaryCrumbs } from './boundary_crumbs';
import { boundaryFromRaw, trailsInBoundaryFromRaw } from './boundary_detail_controller';
import { initialData } from './data';
import { Header } from './page';
import { searchTrailsFromRaw } from './search_controller';
import { LIMIT, LoadingController, SearchResultsOverviewController, State } from './search_results_overview_controller';
import { setTitle } from './title';
import { TrailSidebar } from './trail_list';
import { TrailPopup } from './trail_popup';

export function SearchResultsOverviewElement(
    {parameters}: {parameters: {[key: string]: string};},
    state: State|undefined,
    updateState: (newState: State) => void) {
  const boundaryId = parameters.boundary ?? undefined;
  const query = parameters.query ?? undefined;

  setTitle(query);

  if (!state || boundaryId !== state.boundaryId || query !== state.searchQuery) {
    let boundary;
    let trailsInBoundary;
    let trailsInBoundaryIds;

    if (boundaryId) {
      const rawBoundary = initialData('boundary', {id: boundaryId});
      if (rawBoundary) {
        boundary = boundaryFromRaw(rawBoundary);
      }

      const rawTrailsInBoundary = initialData('trails_in_boundary', {boundary_id: boundaryId});
      if (rawTrailsInBoundary) {
        trailsInBoundary = trailsInBoundaryFromRaw(rawTrailsInBoundary);
        trailsInBoundaryIds = new Set(trailsInBoundary.map(t => t.id));
      }
    }

    let searchTrails;
    let searchTrailsIds;
    if (query) {
      const rawSearchTrails = initialData('search_trails', {query, limit: LIMIT});
      if (rawSearchTrails) {
        searchTrails = searchTrailsFromRaw(rawSearchTrails);
        searchTrailsIds = new Set(searchTrails.map(t => t.id));
      }
    }

    state = {
      boundary,
      boundaryId,
      filterInBoundary: !!boundary,
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

  return <>
      {((!boundaryId || state.boundary) && (!query || state.searchTrails))
          ? <Content
              boundaryId={boundaryId}
              query={query}
              parameters={parameters}
              state={state}
              updateState={updateState} />
          : <Loading boundaryId={boundaryId} query={query} state={state} updateState={updateState} />
      }
  </>;
}

function Loading({boundaryId, query, state, updateState}: {
  boundaryId?: string,
  query?: string,
  state: State,
  updateState: (newState: State) => void,
}) {
  return <>
    <div
        js={corgi.bind({
          controller: LoadingController,
          args: {boundaryId, query},
          events: {
            render: 'wakeup',
          },
          state: [state, updateState],
        })}
    >
      Loading...
    </div>
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
  let bound;
  if (query) {
    if (state.searchTrails) {
      filteredTrails = state.searchTrails.filter(t => filter(t.id));

      bound = emptyLatLngRect();
      for (const trail of filteredTrails) {
        if (trail.bound.low[0] < bound.low[0]) {
          bound.low[0] = trail.bound.low[0];
        }
        if (trail.bound.high[0] > bound.high[0]) {
          bound.high[0] = trail.bound.high[0];
        }
        if (trail.bound.low[1] < bound.low[1]) {
          bound.low[1] = trail.bound.low[1];
        }
        if (trail.bound.high[1] > bound.high[1]) {
          bound.high[1] = trail.bound.high[1];
        }
      }
    }
  } else if (boundaryId) {
    if (state.boundary && state.trailsInBoundary) {
      bound = state.boundary.bound;
      if (state.filterInBoundary) {
        filteredTrails = state.trailsInBoundary;
      } else {
        filteredTrails = state.nearbyTrails;
      }
    }
  } else {
    filteredTrails = state.nearbyTrails;
  }

  let llz;
  if (
      !bound || parameters.lat || parameters.lng || parameters.zoom) {
    llz = {
      lat: floatCoalesce(parameters.lat, 46.859369),
      lng: floatCoalesce(parameters.lng, -121.747888),
      zoom: floatCoalesce(parameters.zoom, 12),
    };
  }

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
              polygon: state.boundary?.polygon,
            },
            query,
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
                  icon="Location"
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
              camera={llz ?? bound ?? {lat: 46.859369, lng: -121.747888, zoom: 12}}
              ref="map"
          />
          {trailDetails}
        </div>
      </div>
    </div>
  </>;
}

function SearchFilter({state}: {state: State}) {
  const boundary = checkExists(state.boundary);
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
          href={`/boundary/${boundary.id}`}
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
        <FlatButton icon="ChromeClose" />
      </span>
    </aside>
  </>;
}
