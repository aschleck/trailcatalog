import { Future } from 'external/dev_april_corgi+/js/common/futures';
import * as corgi from 'external/dev_april_corgi+/js/corgi';
import {
  ACTION,
  CHANGED,
  FOCUSED,
  PRESSED,
  UNFOCUSED,
} from 'external/dev_april_corgi+/js/emu/events';
import { Input } from 'external/dev_april_corgi+/js/emu/input';
import { RelationCategory, SEARCHABLE_POINT_LABELS } from 'java/org/trailcatalog/models/categories';
import { S2LatLng } from 'java/org/trailcatalog/s2';
import { SearchResponse, SearchResultKind } from 'trails_lat/proto/data_pb';

import { requestData } from './data';

export interface SearchState {
  query: string;
  // Undefined while there is nothing to show, either because the query is empty or because the
  // box isn't focused
  results: SearchHit[]|undefined;
  // Index into results that Enter picks
  highlighted: number;
}

/** A search result, or coordinates typed into the box. */
export interface SearchHit {
  name: string;
  // What it is, like Campground
  label: string;
  // The name the query matched when it isn't name, or empty
  matched: string;
  within: string[];
  low: [number, number];
  high: [number, number];
}

export const EMPTY_SEARCH: SearchState = {query: '', results: undefined, highlighted: 0};

const BOUNDARY_LABELS = new Map<number, string>([
  [RelationCategory.BOUNDARY_CLIMBING_AREA, 'Climbing area'],
  [RelationCategory.BOUNDARY_CLIMBING_BOULDER, 'Boulder'],
  [RelationCategory.BOUNDARY_CLIMBING_CRAG, 'Crag'],
]);

/** Returns what a result is, for the line under its name. */
export function searchLabel(kind: SearchResultKind, type: number): string {
  switch (kind) {
    case SearchResultKind.BOUNDARY:
      return BOUNDARY_LABELS.get(type) ?? 'Area';
    case SearchResultKind.POINT:
      return SEARCHABLE_POINT_LABELS.get(type) ?? 'Place';
    case SearchResultKind.TRAIL:
      return 'Trail';
    default:
      return '';
  }
}

// Two numbers in degrees, like 47.6062, -122.3321
const COORDINATES = /^\s*(-?\d+(?:\.\d+)?)\s*[,\s]\s*(-?\d+(?:\.\d+)?)\s*$/;

/** Returns the coordinates typed into the box, or undefined when it holds something else. */
export function parseCoordinates(query: string): SearchHit|undefined {
  const match = COORDINATES.exec(query);
  if (!match) {
    return undefined;
  }
  const lat = Number(match[1]);
  const lng = Number(match[2]);
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return undefined;
  }
  return {
    name: `${lat}, ${lng}`,
    label: 'Coordinates',
    matched: '',
    within: [],
    low: [lat, lng],
    high: [lat, lng],
  };
}

/** Searches for what is typed into the box once typing pauses. */
export class SearchQuery {

  // Waits for typing to pause, so that each keystroke doesn't send a search. close() cancels it, or
  // else the last keystroke's search reopens the results after Enter picks one.
  private pending: ReturnType<typeof setTimeout>|undefined;
  // Moves with every search sent or closed, so that a slow answer to an older query is dropped
  private generation: number;

  constructor(
      // Where to rank results around, and how far out
      private readonly near: () => {center: S2LatLng; radiusMeters: number},
      private readonly current: () => SearchState,
      private readonly show: (search: SearchState) => void) {
    this.pending = undefined;
    this.generation = 0;
  }

  trigger(): void {
    clearTimeout(this.pending);
    this.pending = setTimeout(() => {
      this.search();
    }, /* delay= */ 150);
  }

  // Hides the results, including ones still on their way.
  close(): void {
    clearTimeout(this.pending);
    this.generation += 1;
    this.show({...this.current(), results: undefined, highlighted: 0});
  }

  private search(): void {
    const query = this.current().query.trim();
    const generation = ++this.generation;
    if (!query) {
      this.show({...this.current(), results: undefined});
      return;
    }

    const coordinates = parseCoordinates(query);
    if (coordinates) {
      this.show({...this.current(), results: [coordinates], highlighted: 0});
      return;
    }

    const {center, radiusMeters} = this.near();
    const loading: Future<SearchResponse> =
        requestData('lat.trails.DataService/Search', {
          query,
          centerLatDegrees: center.latDegrees(),
          centerLngDegrees: center.lngDegrees(),
          radiusMeters,
        });
    loading.then(
        response => {
          if (generation !== this.generation) {
            return;
          }

          const results: SearchHit[] = response.results.map(result => ({
            name: result.name,
            label: searchLabel(result.kind, result.type),
            matched: result.matchedName,
            within: result.within,
            low: [result.lowLatDegrees, result.lowLngDegrees],
            high: [result.highLatDegrees, result.highLngDegrees],
          }));
          this.show({...this.current(), results, highlighted: 0});
        },
        e => {
          console.error(e);
        });
  }
}

export function SearchBox({state}: {state: SearchState}) {
  const results = state.results;
  return <>
    <div className="max-w-96 relative text-sm w-full">
      <Input
          className="
              [&_input]:outline-none
              bg-gray-800
              border
              border-transparent
              focus-within:border-blue-500
              px-2
              py-1
              rounded
          "
          forceValue={true}
          placeholder="Search places, trails, or coordinates"
          // The default size of 20 sets a min-content width that pushes Log in off narrow screens.
          size={1}
          type="search"
          value={state.query}
          unboundEvents={{
            corgi: [
              [ACTION, 'searchSubmitted'],
              [CHANGED, 'searchChanged'],
              [FOCUSED, 'searchFocused'],
              [PRESSED, 'searchKeyPressed'],
              [UNFOCUSED, 'searchBlurred'],
            ],
          }}
      />
      {results
          ? <div
                className="
                    absolute
                    bg-gray-900
                    left-0
                    mt-1
                    overflow-y-auto
                    max-h-[70vh]
                    rounded
                    shadow-lg
                    top-full
                    w-full
                "
            >
              {results.length === 0
                  ? <div className="px-3 py-2 text-gray-400">No results</div>
                  : results.map((hit, i) =>
                      <div
                          className={
                            'cursor-pointer px-3 py-2'
                                + (i === state.highlighted ? ' bg-gray-700' : ' hover:bg-gray-800')
                          }
                          data={{index: String(i)}}
                          // A click lands after focusout, which would close the list first.
                          unboundEvents={{pointerdown: 'searchResultPicked'}}
                      >
                        <div className="truncate">{hit.name}</div>
                        <div className="text-gray-400 text-xs truncate">
                          {[hit.label, hit.matched, ...hit.within].filter(s => s).join(' · ')}
                        </div>
                      </div>
                  )
              }
            </div>
          : ''
      }
    </div>
  </>;
}
