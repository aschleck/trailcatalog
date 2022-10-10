import * as corgi from 'js/corgi';
import { FlatButton } from 'js/dino/button';
import { Checkbox } from 'js/dino/checkbox';

import { currentUrl } from './common/ssr_aware';
import { emptyLatLngRect } from './common/types';
import { DATA_CHANGED, HOVER_CHANGED, MAP_MOVED, SELECTION_CHANGED } from './map/events';
import { TrailSearchResult } from './models/types';

import { BoundaryCrumbs } from './boundary_crumbs';
import { boundaryFromRaw, trailsInBoundaryFromRaw } from './boundary_overview_controller';
import { initialData } from './data';
import { searchTrailsFromRaw } from './search_controller';
import { LIMIT, SearchResultsOverviewController, State } from './search_results_overview_controller';
import { TrailSidebar } from './trail_list';
import { TrailPopup } from './trail_popup';
import { ViewportLayoutElement } from './viewport_layout_element';

export function SearchResultsOverviewElement(
    {}: {}, state: State|undefined, updateState: (newState: State) => void) {
  const search = currentUrl().searchParams;
  const boundaryId = search.get('boundary') ?? undefined;
  const query = search.get('query') ?? undefined;

  if (!state) {
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
      filterInBoundary: !!boundary,
      searchTrails,
      searchTrailsIds,
      trailsFilter: () => true,
      trailsInBoundary,
      trailsInBoundaryFilter: () => true,
      trailsInBoundaryIds,
      hovering: undefined,
      nearbyTrails: [],
      selectedCardPosition: [-1, -1],
      selectedTrails: [],
    };
  }

  const filter = state.filterInBoundary ? state.trailsInBoundaryFilter : state.trailsFilter;

  let filteredTrails = undefined;
  let bound = emptyLatLngRect();
  if (query) {
    if (state.searchTrails) {
      filteredTrails = state.searchTrails.filter(t => filter(t.id));

      const bound = emptyLatLngRect();
      for (const trail of filteredTrails) {
        if (trail.marker[0] < bound.low[0]) {
          bound.low[0] = trail.marker[0];
        }
        if (trail.marker[0] > bound.high[0]) {
          bound.high[0] = trail.marker[0];
        }
        if (trail.marker[1] < bound.low[1]) {
          bound.low[1] = trail.marker[1];
        }
        if (trail.marker[1] > bound.high[1]) {
          bound.high[1] = trail.marker[1];
        }
      }
    }
  } else if (state.boundary && state.trailsInBoundary) {
    bound = state.boundary.bound;
    if (state.filterInBoundary) {
      filteredTrails = state.trailsInBoundary;
    } else {
      filteredTrails = state.nearbyTrails;
    }
  }

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

  return <>
    <div
        js={corgi.bind({
          controller: SearchResultsOverviewController,
          args: {
            boundaryId,
            query,
          },
          events: {
            corgi: [
              [DATA_CHANGED, 'onDataChange'],
              [HOVER_CHANGED, 'onHoverChanged'],
              [MAP_MOVED, 'onMove'],
              [SELECTION_CHANGED, 'onSelectionChanged'],
            ],
            render: 'wakeup',
          },
          key: `${search.get('boundary')}&${query}`,
          state: [state, updateState],
        })}
        className="flex flex-col h-full"
    >
      {
        filteredTrails
            ? <ViewportLayoutElement
                bannerContent={<SearchFilter state={state} />}
                camera={bound}
                filters={{
                  trail: filter,
                }}
                overlay={
                  state.boundary
                      ? {
                        content: trailDetails,
                        polygon: state.boundary.polygon,
                      }
                      : undefined
                }
                sidebarContent={
                  <TrailSidebar
                      hovering={state.hovering}
                      nearby={filteredTrails}
                  />
                }
            />
            : "Loading..."
      }
    </div>
  </>;
}

function SearchFilter({state}: {state: State}) {
  const divider = <div className="bg-black-opaque-20 h-full w-px" />;
  return <>
    <aside className="bg-tc-gray-200 flex p-2">
      {
        state.boundary
            ? <>
              <div className="bg-tc-green-700 flex gap-2 items-center px-2 rounded">
                <img
                    aria-hidden="true"
                    className="h-[1em] my-1"
                    src="/static/images/icons/boundary-filled.svg" />
                {state.boundary.name}

                {divider}

                <label>
                  <Checkbox
                      checked={state.filterInBoundary}
                      className="my-1"
                      unboundEvents={{
                        click: 'toggleBoundaryFilter',
                      }}
                  />

                  Filter by boundary
                </label>

                {divider}

                <FlatButton
                    className="my-1"
                    icon="CalculatorMultiply"
                    unboundEvents={{
                      click: 'clearBoundary',
                    }}
                />
              </div>
            </>
            : ''
      }
    </aside>
  </>;
}
