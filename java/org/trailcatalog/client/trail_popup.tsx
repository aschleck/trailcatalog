import { PointCategory } from 'java/org/trailcatalog/models/categories';
import { checkExhaustive } from 'js/common/asserts';
import * as corgi from 'js/corgi';

import { metersToMiles } from './common/math';
import { Vec2 } from './common/types';
import { Path, Point, Trail } from './models/types';

const POINT_CATEGORY_TO_LABEL =
    new Map([
      [PointCategory.AMENITY, 'Amenity'],
      [PointCategory.AMENITY_CAMP, 'Camp'],
      [PointCategory.AMENITY_CAMP_PITCH, 'Camp pitch'],
      [PointCategory.AMENITY_CAMP_SITE, 'Campsite'],
      [PointCategory.AMENITY_FIRE, 'Fire'],
      [PointCategory.AMENITY_FIRE_BARBECUE, 'Barbecue'],
      [PointCategory.AMENITY_FIRE_PIT, 'Fire pit'],
      [PointCategory.AMENITY_HUT, 'Hut'],
      [PointCategory.AMENITY_HUT_ALPINE, 'Alpine hut'],
      [PointCategory.AMENITY_HUT_WILDERNESS, 'Wilderness hut'],
      [PointCategory.AMENITY_PARKING, 'Parking'],
      [PointCategory.AMENITY_PICNIC, 'Picnic'],
      [PointCategory.AMENITY_PICNIC_SITE, 'Picnic site'],
      [PointCategory.AMENITY_PICNIC_TABLE, 'Picnic table'],
      [PointCategory.AMENITY_SHELTER, 'Shelter'],
      [PointCategory.AMENITY_TOILETS, 'Toilets'],
      [PointCategory.AMENITY_WATER, 'Water'],
      [PointCategory.AMENITY_WATER_DRINKING, 'Drinking water'],
      [PointCategory.INFORMATION, 'Information'],
      [PointCategory.INFORMATION_GUIDE_POST, 'Guide post'],
      [PointCategory.INFORMATION_VISITOR_CENTER, 'Visitor center'],
      [PointCategory.NATURAL, 'Natural'],
      [PointCategory.NATURAL_CAVE_ENTRANCE, 'Cave entrance'],
      [PointCategory.NATURAL_PEAK, 'Peak'],
      [PointCategory.NATURAL_SADDLE, 'Saddle'],
      [PointCategory.NATURAL_VOLCANO, 'Volcano'],
      [PointCategory.NATURAL_WATERFALL, 'Waterfall'],
      [PointCategory.WAY, 'Way'],
      [PointCategory.WAY_MOUNTAIN_PASS, 'Mountain pass'],
      [PointCategory.WAY_PATH, 'Path'],
      [PointCategory.WAY_PATH_TRAILHEAD, 'Trailhead'],
      [PointCategory.WAY_VIEWPOINT, 'Viewpoint'],
    ]);

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
  const label =
      point.name ?? POINT_CATEGORY_TO_LABEL.get(point.type) ?? `Node ${point.sourceNode}`;
  return <>
    <a
        className="block cursor-pointer no-underline p-2 hover:bg-tc-gray-100"
        href={`https://www.openstreetmap.org/node/${point.sourceNode}`}
        target="_blank"
    >
      <header className="font-bold font-lg grow">
        {label}
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
