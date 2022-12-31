import * as corgi from 'js/corgi';

import { metersToMiles } from './common/math';
import { Vec2 } from './common/types';
import { Trail } from './models/types';

export function TrailPopup({ position, trails }: {
  position: Vec2,
  trails: Trail[],
}) {
  return <div
      className="
          absolute
          bg-white
          font-header
          mb-4
          rounded
          -translate-x-1/2
          translate-y-[calc(-100%-0.75rem)]
      "
      style={`left: ${position[0]}px; top: ${position[1]}px`}
  >
    {trails.map(trail =>
      trail.id >= 0n
          ? <TrailLink trail={trail} />
          : <OsmWayLink id={-trail.id} />
    )}
  </div>;
}

function TrailLink({trail}: {trail: Trail}) {
  return <>
    <a
        className="block cursor-pointer no-underline p-2 hover:bg-tc-gray-100"
        data-trail-id={trail.id}
        href={`/goto/trail/${trail.id}`}
        unboundEvents={{
          mouseover: 'highlightTrail',
          mouseout: 'unhighlightTrail',
        }}
    >
      <header className="font-bold font-lg grow">
        {trail.name}
      </header>
      {[
        ['Distance:', `${metersToMiles(trail.lengthMeters).toFixed(1)} miles`],
      ].map(([label, content]) =>
        <section>
          <span className="font-medium text-tc-gray-400">
            {label}
          </span>
          {' '}
          <span>
            {content}
          </span>
        </section>
      )}
    </a>
  </>;
}

function OsmWayLink({id}: {id: bigint}) {
  return <>
    <a
        className="block cursor-pointer no-underline p-2 hover:bg-tc-gray-100"
        href={`https://www.openstreetmap.org/way/${id}`}
        target="_blank"
    >
      <header className="font-bold font-lg grow">
        Way {id}
      </header>
    </a>
  </>;
}
