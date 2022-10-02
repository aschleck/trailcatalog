import * as corgi from 'js/corgi';
import { Link } from 'js/corgi/history/link_element';

import { formatDistance } from './common/formatters';
import { HOVER_HEX_PALETTE } from './map/common/colors';
import { Trail } from './models/types';

export function TrailListItem({ highlight, trail }: { highlight: boolean, trail: Trail }) {
  const distance = formatDistance(trail.lengthMeters);
  return <>
    <a
        className={
          'border-b flex gap-2 items-stretch pr-2 py-3'
              + (highlight ? ' bg-tc-gray-700' : '')
        }
        href={`/trail/${trail.id}`}
        data-trail-id={`${trail.id}`}
        unboundEvents={{
          click: 'viewTrail',
          mouseover: 'highlightTrail',
          mouseout: 'unhighlightTrail',
        }}>
      <div
          className="my-1 rounded-r-lg w-1"
          style={highlight ? `background-color: ${HOVER_HEX_PALETTE.stroke}` : ''}
      >
      </div>
      <div className="font-lg grow">{trail.name}</div>
      <div className="shrink-0 w-24">
        <span className="font-lg">
          {distance.value}
        </span>
        {' '}
        <span className="font-xs text-tc-gray-400">{distance.unit}</span>
      </div>
    </a>
  </>;
}

