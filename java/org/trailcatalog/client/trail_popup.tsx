import { PointCategory } from 'java/org/trailcatalog/models/categories';
import { checkExhaustive } from 'external/dev_april_corgi+/js/common/asserts';
import * as corgi from 'external/dev_april_corgi+/js/corgi';
import { Vec2 } from 'js/map/common/types';

import { formatDistance } from 'js/units/formatters';
import { Path, Point, Trail } from './models/types';

const POINT_CATEGORY_TO_LABEL =
    new Map([
      [PointCategory.RESUPPLY, 'Resupply'],
      [PointCategory.RESUPPLY_CONVENIENCE, 'Convenience store'],
      [PointCategory.RESUPPLY_FUEL, 'Fuel'],
      [PointCategory.RESUPPLY_OUTDOOR, 'Outdoor store'],
      [PointCategory.RESUPPLY_POST_OFFICE, 'Post office'],
      [PointCategory.RESUPPLY_SUPERMARKET, 'Supermarket'],
      [PointCategory.SAFETY, 'Safety'],
      [PointCategory.SAFETY_CLINIC, 'Clinic'],
      [PointCategory.SAFETY_DEFIBRILLATOR, 'Defibrillator'],
      [PointCategory.SAFETY_EMERGENCY_PHONE, 'Emergency phone'],
      [PointCategory.SAFETY_MOUNTAIN_RESCUE, 'Mountain rescue'],
      [PointCategory.SAFETY_PHARMACY, 'Pharmacy'],
      [PointCategory.LODGING, 'Lodging'],
      [PointCategory.LODGING_CAMP, 'Camp'],
      [PointCategory.LODGING_CAMP_PITCH, 'Camp pitch'],
      [PointCategory.LODGING_CAMP_SITE, 'Campsite'],
      [PointCategory.LODGING_CAMP_CARAVAN_SITE, 'Caravan site'],
      [PointCategory.LODGING_HUT, 'Hut'],
      [PointCategory.LODGING_HUT_ALPINE, 'Alpine hut'],
      [PointCategory.LODGING_HUT_WILDERNESS, 'Wilderness hut'],
      [PointCategory.LODGING_CHALET, 'Chalet'],
      [PointCategory.LODGING_GUEST_HOUSE, 'Guest house'],
      [PointCategory.LODGING_HOSTEL, 'Hostel'],
      [PointCategory.LODGING_HOTEL, 'Hotel'],
      [PointCategory.LODGING_MOTEL, 'Motel'],
      [PointCategory.FACILITY, 'Facility'],
      [PointCategory.FACILITY_FIRE, 'Fire'],
      [PointCategory.FACILITY_FIRE_BARBECUE, 'Barbecue'],
      [PointCategory.FACILITY_FIRE_PIT, 'Fire pit'],
      [PointCategory.FACILITY_PICNIC, 'Picnic'],
      [PointCategory.FACILITY_PICNIC_SITE, 'Picnic site'],
      [PointCategory.FACILITY_PICNIC_TABLE, 'Picnic table'],
      [PointCategory.FACILITY_BICYCLE_REPAIR, 'Bicycle repair'],
      [PointCategory.FACILITY_LAUNDRY, 'Laundry'],
      [PointCategory.FACILITY_SHELTER, 'Shelter'],
      [PointCategory.FACILITY_SHOWER, 'Shower'],
      [PointCategory.FACILITY_TOILETS, 'Toilets'],
      [PointCategory.WATER, 'Water'],
      [PointCategory.WATER_DRINKING, 'Drinking water'],
      [PointCategory.WATER_POINT, 'Water point'],
      [PointCategory.WATER_SPRING, 'Spring'],
      [PointCategory.WATER_TAP, 'Water tap'],
      [PointCategory.INFORMATION, 'Information'],
      [PointCategory.INFORMATION_GUIDE_POST, 'Guide post'],
      [PointCategory.INFORMATION_RANGER_STATION, 'Ranger station'],
      [PointCategory.INFORMATION_VISITOR_CENTER, 'Visitor center'],
      [PointCategory.SIGHT, 'Sight'],
      [PointCategory.SIGHT_OBSERVATION_TOWER, 'Observation tower'],
      [PointCategory.SIGHT_RUINS, 'Ruins'],
      [PointCategory.SIGHT_VIEWPOINT, 'Viewpoint'],
      [PointCategory.NATURAL, 'Natural'],
      [PointCategory.NATURAL_CAVE_ENTRANCE, 'Cave entrance'],
      [PointCategory.NATURAL_HOT_SPRING, 'Hot spring'],
      [PointCategory.NATURAL_PEAK, 'Peak'],
      [PointCategory.NATURAL_SADDLE, 'Saddle'],
      [PointCategory.NATURAL_MOUNTAIN_PASS, 'Mountain pass'],
      [PointCategory.NATURAL_VOLCANO, 'Volcano'],
      [PointCategory.NATURAL_WATERFALL, 'Waterfall'],
      [PointCategory.ACCESS, 'Access'],
      [PointCategory.ACCESS_PARKING, 'Parking'],
      [PointCategory.ACCESS_TRAILHEAD, 'Trailhead'],
      [PointCategory.ACCESS_TRANSIT, 'Transit'],
      [PointCategory.ACCESS_TRANSIT_BUS_STOP, 'Bus stop'],
      [PointCategory.ACCESS_TRANSIT_FERRY_TERMINAL, 'Ferry terminal'],
      [PointCategory.ACCESS_TRANSIT_STATION, 'Station'],
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
  const valid = trail.lengthMeters >= 0;
  const distance = formatDistance(trail.lengthMeters);
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
      <section>
        <span className="font-medium text-tc-gray-400">
          Distance:
        </span>
        {' '}
        <span className={valid ? '' : 'text-tc-error-500'}>
          {valid ? `${distance.value} ${distance.unit}` : 'bad OSM data'}
        </span>
      </section>
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
