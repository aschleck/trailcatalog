import * as corgi from 'external/dev_april_corgi~/js/corgi';

import { formatCount, formatDistance, formatHeight } from './common/formatters';
import { Path, Point, Trail, TrailSearchResult } from './models/types';

import { BoundaryCrumbs } from './boundary_crumbs';

const TRAIL_COUNT_MAX = 100;

interface SimpleTrail {
  id: bigint|string;
  name: string;
  elevationDownMeters: number;
  elevationUpMeters: number;
  lengthMeters: number;
  boundaries?: Array<{
    id: bigint|string;
    name: string;
    type: number;
  }>;
}

export function TrailSidebar({hovering, mobileOpen, nearby}: {
  hovering: Path|Point|Trail|undefined,
  mobileOpen: boolean,
  nearby: SimpleTrail[],
}) {
  let filteredTrails;
  let hiddenTrailCount;
  if (nearby.length > TRAIL_COUNT_MAX) {
    filteredTrails = nearby.slice(0, TRAIL_COUNT_MAX);
    hiddenTrailCount = nearby.length - TRAIL_COUNT_MAX;
  } else {
    filteredTrails = nearby;
    hiddenTrailCount = 0;
  }

  return <>
    <div
        className={
          "bg-white overflow-y-scroll z-10"
              + " absolute bottom-0 max-h-[50%] shrink-0 w-full"
              + " md:max-h-full md:relative md:w-96"
        }
    >
      <table
          className="my-4 w-full"
          unboundEvents={{click: 'toggleSidebar'}}
      >
        <thead>
          <tr className="border-b h-8">
            <th className="w-1"></th>
            <th className="w-3"></th>
            <th>
              <span className="font-bold text-2xl">{formatCount(nearby.length)}</span>
              {' '}trails
            </th>
            <th>Distance</th>
            <th className="w-1"></th>
            <th>Gain</th>
            <th className="w-1"></th>
          </tr>
        </thead>
        <tbody
            className={'text-sm' + (mobileOpen ? ' table-row-group' : ' hidden md:table-row-group')}
        >
          {filteredTrails.map(trail =>
              <TrailListItem
                  highlight={hovering?.id === trail.id}
                  trail={trail}
              />
          )}
        </tbody>
      </table>
      {hiddenTrailCount > 0
        ?
            <footer className="m-4">
              <span className="font-medium">{hiddenTrailCount}</span>
              {' '}hidden trails
            </footer>
        : ''}
    </div>
  </>;
}

export function TrailListItem({ highlight, trail }: { highlight: boolean, trail: SimpleTrail }) {
  const valid = trail.lengthMeters >= 0;
  const distance = formatDistance(trail.lengthMeters);
  const elevationUp = formatHeight(trail.elevationUpMeters);
  return <>
    <tr
        className={
          'border-b cursor-pointer'
              + (valid ? '' : ' text-tc-error-500')
              + (highlight ? ' bg-tc-gray-100' : '')
        }
        data-trail-id={`${trail.id}`}
        unboundEvents={{
          click: 'viewTrail',
          mouseover: 'highlightTrail',
          mouseout: 'unhighlightTrail',
        }}>
      <td
          className={
            'h-12 rounded-r-lg'
                + (
                    highlight ? (valid ? ' bg-black' : ' bg-tc-error-500') : ''
                )
          }
      >
      </td>
      <td></td>
      <td>
        <a href={`/goto/trail/${trail.id}`}>
          {trail.name}
        </a>
        {
          trail.boundaries
              ? <div className="text-sm text-tc-gray-400">
                <BoundaryCrumbs boundaries={trail.boundaries} />
              </div>
              : ''
        }
      </td>
      <td>
        {
          valid
              ? <>
                  <span className="font-medium text-md">
                    {distance.value}
                  </span>
                  {' '}
                  <span className="text-xs text-tc-gray-400">{distance.unit}</span>
                </>
              : '!'
        }
      </td>
      <td></td>
      <td>
        {
          valid
              ? <>
                  <span className="font-medium text-md">
                    {elevationUp.value}
                  </span>
                  {' '}
                  <span className="text-xs text-tc-gray-400">{elevationUp.unit}</span>
                </>
              : '!'
        }
      </td>
      <td></td>
    </tr>
  </>;
}

