import * as corgi from 'js/corgi';
import { Link } from 'js/corgi/history/link_element';

import { metersToMiles } from './common/math';
import { HOVER_HEX_PALETTE } from './map/common/colors';
import { Trail } from './models/types';

export function TrailListItem({ highlight, trail }: { highlight: boolean, trail: Trail }) {
  return <>
    <a
        className={
          'cursor-pointer flex gap-2 items-stretch pr-2'
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
      <div className="font-lg grow py-2">{trail.name}</div>
      <div className="py-2 shrink-0 w-24">
        <span className="font-lg">
          {metersToMiles(trail.lengthMeters).toFixed(1)}
        </span>
        {' '}
        <span className="font-xs text-tc-gray-400">miles</span>
      </div>
    </a>
  </>;
}

