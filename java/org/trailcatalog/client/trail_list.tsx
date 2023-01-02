import * as corgi from 'js/corgi';

import { formatCount, formatDistance, formatHeight } from './common/formatters';
import { HOVER_HEX_PALETTE } from './map/common/colors';
import { Path, Trail, TrailSearchResult } from './models/types';

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

export function TrailSidebar({hovering, nearby}: {
  hovering: Path|Trail|undefined,
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
    <header className="border-b px-3 py-4">
      <span className="font-bold text-xl">{formatCount(nearby.length)}</span>
      {' '}trails found
    </header>
    {filteredTrails.map(trail =>
        <TrailListItem
            highlight={hovering?.id === trail.id}
            trail={trail}
        />
    )}
    {hiddenTrailCount > 0 ? <footer>{hiddenTrailCount} hidden trails</footer> : ''}
  </>;
}

export function TrailListItem({ highlight, trail }: { highlight: boolean, trail: SimpleTrail }) {
  const distance = formatDistance(trail.lengthMeters);
  const elevationUp = formatHeight(trail.elevationUpMeters);
  return <>
    <div
        className={
          'border-b cursor-pointer flex gap-2 items-stretch pr-2 py-3'
              + (highlight ? ' bg-tc-gray-100' : '')
        }
        data-trail-id={`${trail.id}`}
        unboundEvents={{
          click: 'viewTrail',
          mouseover: 'highlightTrail',
          mouseout: 'unhighlightTrail',
        }}>
      <div
          className="my-1 rounded-r-lg shrink-0 w-1"
          style={highlight ? `background-color: ${HOVER_HEX_PALETTE.stroke}` : ''}
      >
      </div>
      <div className="font-lg grow">
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
      </div>
      <div className="shrink-[0.1] w-24">
        <div>
          <span className="font-lg">
            {distance.value}
          </span>
          {' '}
          <span className="font-xs text-tc-gray-400">{distance.unit}</span>
        </div>
        <div>
          <span className="font-lg">
            {elevationUp.value}
          </span>
          {' '}
          <span className="font-xs text-tc-gray-400">{elevationUp.unit}</span>
        </div>
      </div>
    </div>
  </>;
}

