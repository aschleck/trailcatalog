import * as corgi from 'external/dev_april_corgi+/js/corgi';
import { CHANGED, ACTION, FOCUSED, PRESSED } from 'external/dev_april_corgi+/js/emu/events';
import { Input } from 'external/dev_april_corgi+/js/emu/input';
import { PointCategory } from 'java/org/trailcatalog/models/categories';
import { SearchResultKind } from 'trails_lat/proto/data_pb';

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

const POINT_LABELS = new Map<number, string>([
  [PointCategory.ACCESS_TRAILHEAD, 'Trailhead'],
  [PointCategory.ACCESS_TRANSIT_AIRPORT, 'Airport'],
  [PointCategory.ACCESS_TRANSIT_FERRY_TERMINAL, 'Ferry terminal'],
  [PointCategory.ACCESS_TRANSIT_STATION, 'Station'],
  [PointCategory.INFORMATION_RANGER_STATION, 'Ranger station'],
  [PointCategory.INFORMATION_VISITOR_CENTER, 'Visitor center'],
  [PointCategory.LODGING_CAMP_CARAVAN_SITE, 'Caravan site'],
  [PointCategory.LODGING_CAMP_SITE, 'Campground'],
  [PointCategory.LODGING_HOSTEL, 'Hostel'],
  [PointCategory.LODGING_HUT_ALPINE, 'Alpine hut'],
  [PointCategory.LODGING_HUT_WILDERNESS, 'Wilderness hut'],
  [PointCategory.LODGING_ROOM_CHALET, 'Chalet'],
  [PointCategory.LODGING_ROOM_GUEST_HOUSE, 'Guest house'],
  [PointCategory.LODGING_ROOM_HOTEL, 'Hotel'],
  [PointCategory.LODGING_ROOM_MOTEL, 'Motel'],
  [PointCategory.NATURAL_CAVE_ENTRANCE, 'Cave'],
  [PointCategory.NATURAL_HOT_SPRING, 'Hot spring'],
  [PointCategory.NATURAL_MOUNTAIN_PASS, 'Pass'],
  [PointCategory.NATURAL_PEAK, 'Peak'],
  [PointCategory.NATURAL_SADDLE, 'Saddle'],
  [PointCategory.NATURAL_VOLCANO, 'Volcano'],
  [PointCategory.NATURAL_WATERFALL, 'Waterfall'],
  [PointCategory.SAFETY_CLINIC, 'Clinic'],
  [PointCategory.SAFETY_MOUNTAIN_RESCUE, 'Mountain rescue'],
  [PointCategory.SIGHT_OBSERVATION_TOWER, 'Observation tower'],
  [PointCategory.SIGHT_VIEWPOINT, 'Viewpoint'],
  [PointCategory.WATER_SPRING, 'Spring'],
  [PointCategory.WATER_TAP, 'Water tap'],
]);

/** Returns what a result is, for the line under its name. */
export function searchLabel(kind: SearchResultKind, type: number): string {
  switch (kind) {
    case SearchResultKind.BOUNDARY:
      return 'Area';
    case SearchResultKind.POINT:
      return POINT_LABELS.get(type) ?? 'Place';
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

export function SearchBox({state}: {state: SearchState}) {
  const results = state.results;
  return <>
    <div className="max-w-96 relative text-sm w-full">
      <Input
          className="bg-gray-800 px-2 py-1 rounded"
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
            ],
            focusout: 'searchBlurred',
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
