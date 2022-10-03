import { checkExists } from 'js/common/asserts';
import * as corgi from 'js/corgi';
import { FlatButton } from 'js/dino/button';
import { Checkbox } from 'js/dino/checkbox';

import { currentUrl } from './common/ssr_aware';
import { DATA_CHANGED, HOVER_CHANGED, MAP_MOVED, SELECTION_CHANGED } from './map/events';
import { Boundary } from './models/types';

import { BoundaryCrumbs } from './boundary_crumbs';
import { boundaryFromRaw, trailsInBoundaryFromRaw } from './boundary_overview_controller';
import { initialData } from './data';
import { searchTrailsFromRaw } from './search_controller';
import { SearchResultsOverviewController, State } from './search_results_overview_controller';
import { TrailListItem } from './trail_list';
import { TrailPopup } from './trail_popup';
import { ViewportLayoutElement } from './viewport_layout_element';

export function SearchResultsOverviewElement(
    {}: {}, state: State|undefined, updateState: (newState: State) => void) {
  const search = currentUrl().searchParams;
  const boundaryId = search.get('boundary') ?? undefined;
  const query = checkExists(search.get('query'));

  if (!state) {
    let boundary;
    let trailsInBoundary;
    if (boundaryId) {
      const rawBoundary = initialData('boundary', {id: boundaryId});
      if (rawBoundary) {
        boundary = boundaryFromRaw(rawBoundary);
      }

      const rawTrailsInBoundary = initialData('trails_in_boundary', {boundary_id: boundaryId});
      if (rawTrailsInBoundary) {
        trailsInBoundary = new Set(trailsInBoundaryFromRaw(rawTrailsInBoundary).map(t => t.id));
      }
    }

    let searchTrails;
    const rawSearchTrails = initialData('search_trails', {query});
    if (rawSearchTrails) {
      searchTrails = searchTrailsFromRaw(rawSearchTrails);
    }

    state = {
      boundary,
      filterInBoundary: !!boundary,
      searchTrails,
      searchTrailsIds: searchTrails ? new Set(searchTrails.map(t => t.id)) : undefined,
      trailsInBoundary,
      hovering: undefined,
      nearbyTrails: [],
      selectedCardPosition: [-1, -1],
      selectedTrails: [],
    };
  }

  const trailFilter = 
      state.filterInBoundary
          ? (id: bigint) => {
            return !state || !state.trailsInBoundary || state.trailsInBoundary.has(id);
          }
          : undefined;

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
            query: search.get('query') ?? undefined,
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
          key: `${search.get('boundary')}&${search.get('query')}`,
          state: [state, updateState],
        })}
        className="flex flex-col h-full"
    >
      <ViewportLayoutElement
          bannerContent={<SearchFilter state={state} />}
          filters={{
            trail: trailFilter,
          }}
          overlay={
            state.boundary
                ? {
                  content: trailDetails,
                  polygon: state.boundary.polygon,
                }
                : undefined
          }
          sidebarContent={<span>cow</span>}
      />
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

                <Checkbox
                    checked={state.filterInBoundary}
                    className="my-1"
                    unboundEvents={{
                      click: 'toggleBoundaryFilter',
                    }}
                />

                Filter by boundary

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
