import { aDescendsB, RelationCategory } from 'java/org/trailcatalog/models/categories';
import * as corgi from 'js/corgi';
import { FlatButton } from 'js/dino/button';
import { FabricIcon } from 'js/dino/fabric';
import { OutlinedInput } from 'js/dino/input';
import { ACTION, CHANGED } from 'js/emu/events';
import { currentUrl } from 'js/server/ssr_aware';

import { formatDistance } from './common/formatters';

import { BoundaryCrumbs } from './boundary_crumbs';
import { TrailSearchResult } from './models/types';
import { SearchController, State } from './search_controller';

export function SearchElement(
    {query}: {query?: string}, state: State|undefined, updateState: (newState: State) => void) {
  if (!state) {
    state = {
      boundaries: [],
      displayedQuery: query ?? '',
      query: query ?? '',
      trails: [],
    };
  }

  return <>
    <div
        className="grow max-w-[24rem] relative"
        js={corgi.bind({
          controller: SearchController,
          state: [state, updateState],
        })}
    >
      <OutlinedInput
          className="peer w-full"
          icon="Search"
          ref="input"
          inset={
            state.query
                ? <>
                  <span
                      unboundEvents={{
                        corgi: [
                          [ACTION, 'clearSearch'],
                        ],
                      }}
                    >
                      <FlatButton
                          className="text-white"
                          dense={true}
                          icon="ChromeClose"
                      />
                    </span>
                  </>
                : ''
          }
          placeholder="Search trails, national parks, or areas"
          value={state.query}
          unboundEvents={{
            corgi: [
              [ACTION, 'search'],
              [CHANGED, 'deferSearch'],
            ],
          }}
      />
      {
        state.boundaries.length + state.trails.length > 0
            ? <SearchResults
                boundaries={state.boundaries}
                className="
                    hidden
                    leading-normal
                    active:block
                    focus-within:block
                    peer-focus-within:block"
                query={state.query}
                trails={state.trails} />
            : <></>
      }
    </div>
  </>;
}

function SearchResults({boundaries, className, query, trails}: {
  boundaries: State['boundaries'],
  className: string,
  query: string,
  trails: State['trails'],
}) {
  const nationalParks = boundaries.filter(b => isNationalParky(b.type));
  const nonParks = boundaries.filter(b => !isNationalParky(b.type));
  return <>
    <div
        className={`
          absolute
          bg-white
          inset-x-0
          overflow-y-scroll
          max-h-[85vh]
          rounded
          text-black
          top-full
          z-50
          ${className}
      `}
      tabIndex="-1"
    >
      <SearchCategory
          icon="/static/images/icons/trail.svg"
          label="Trails"
          limit={{
            allHref: `/search?query=${query}`,
            count: 5,
          }}
          results={trails.map(trail => <>
            <ResultItem
                aside={<TrailDistance trail={trail} />}
                boundaries={trail.boundaries}
                href={`/goto/trail/${trail.id}`}
                text={trail.name}
                query={query}
            />
          </>)}
      />
      <div className="border-t mt-4"></div>
      <SearchCategory
          icon="/static/images/icons/national-park.svg"
          label="National Parks"
          results={nationalParks.map(boundary => <>
            <ResultItem
                boundaries={boundary.boundaries}
                href={`/search?boundary=${boundary.id}`}
                text={boundary.name}
                query={query}
            />
          </>)}
      />
      <div className="border-t mt-4"></div>
      <SearchCategory
          icon="/static/images/icons/boundary-filled.svg"
          label="Areas"
          results={nonParks.map(boundary => <>
            <ResultItem
                boundaries={boundary.boundaries}
                href={`/search?boundary=${boundary.id}`}
                text={boundary.name}
                query={query}
            />
          </>)}
      />
    </div>
  </>;
}

function ResultItem({aside, boundaries, href, text, query}: {
  aside?: corgi.VElementOrPrimitive;
  boundaries: Array<{
    id: string;
    name: string;
    type: number;
  }>;
  href: string;
  text: string;
  query: string;
}) {
  return <>
    <div className="flex">
      <div className="basis-3/4">
        <div>
          <a href={href}>
            <HighlightText haystack={text} needle={query} />
          </a>
        </div>
        <div className="font-normal text-sm text-tc-gray-400">
          <BoundaryCrumbs boundaries={boundaries} />
        </div>
      </div>
      <div className="basis-1/4 text-end">
        {aside ?? <div></div>}
      </div>
    </div>
  </>;
}

function SearchCategory({icon, label, limit, results}: {
  icon: string,
  label: string,
  limit?: {
    allHref: string;
    count: number;
  },
  results: corgi.VElementOrPrimitive[],
}) {
  const slice = results.slice(0, limit?.count ?? results.length);
  return <>
    <div className="mt-4">
      <div className="flex font-bold gap-2 items-center leading-none px-3">
        <img
            aria-hidden="true"
            src={icon}
            className="h-4"
        />
        {label}
      </div>
      {
          slice.length > 0
              ? slice.map((c, i) => <>
                  {i > 0 ? <div className="border-t"></div> : <></>}
                  <div className="font-header font-medium px-3 my-4">
                    {c}
                  </div>
                </>)
              : <>
                <div className="font-xs font-medium italic ml-6 mt-2 px-3 text-tc-gray-400">
                  No search results
                </div>
              </>
      }
      {
          limit && slice.length < results.length
              ? <>
                <a
                    className="font-xs font-medium px-3 text-tc-highlight-2 underline"
                    href={limit.allHref}
                >
                  {results.length - slice.length} more results</a>
                </>
              : <></>
      }
    </div>
  </>;
}

function HighlightText({needle, haystack}: {needle: string, haystack: string}) {
  const index = haystack.toLocaleLowerCase().indexOf(needle.toLocaleLowerCase());
  if (index < 0) {
    return <span>{haystack}</span>;
  } else {
    const length = needle.length;
    return <>
      <span>{haystack.substr(0, index)}</span>
      <span className="font-bold">{haystack.substr(index, length)}</span>
      <span>{haystack.substr(index + length)}</span>
    </>;
  }
}

function TrailDistance({trail}: {trail: TrailSearchResult}) {
  const distance = formatDistance(trail.lengthMeters);
  return <>
    <span className="font-lg">
      {distance.value}
    </span>
    {' '}
    <span className="font-xs text-tc-gray-400">{distance.unit}</span>
  </>;
}

function isNationalParky(type: number): boolean {
  return aDescendsB(type, RelationCategory.BOUNDARY_NATIONAL_PARK)
      || aDescendsB(type, RelationCategory.BOUNDARY_PROTECTED_AREA_2)
}
