import { checkExhaustive } from 'js/common/asserts';
import * as corgi from 'js/corgi';

import { metersToMiles } from './common/math';
import { Vec2 } from './common/types';
import { Path, Point, Trail } from './models/types';

export function TrailPopup({ items, position }: {
  items: Array<Path|Point|Trail>,
  position: Vec2,
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
    {items.map(item => <Link item={item} />)}
  </div>;
}

function Link({item}: {item: Path|Point|Trail}) {
  if (item instanceof Path) {
    return <OsmWayLink path={item} />;
  } else if (item instanceof Point) {
    return <OsmNodeLink point={item} />;
  } else if (item instanceof Trail) {
    return <TrailLink trail={item} />;
  } else {
    checkExhaustive(item);
  }
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

function OsmNodeLink({point}: {point: Point}) {
  return <>
    <a
        className="block cursor-pointer no-underline p-2 hover:bg-tc-gray-100"
        href={`https://www.openstreetmap.org/node/${point.sourceNode}`}
        target="_blank"
    >
      <header className="font-bold font-lg grow">
        {point.name ?? `Node ${point.sourceNode}`}
      </header>
    </a>
  </>;
}

function OsmWayLink({path}: {path: Path}) {
  return <>
    <a
        className="block cursor-pointer no-underline p-2 hover:bg-tc-gray-100"
        href={`https://www.openstreetmap.org/way/${path.sourceWay}`}
        target="_blank"
    >
      <header className="font-bold font-lg grow">
        Way {path.sourceWay}
      </header>
    </a>
  </>;
}
