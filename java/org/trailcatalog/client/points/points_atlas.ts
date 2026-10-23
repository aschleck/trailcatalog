import { PointCategory } from 'java/org/trailcatalog/models/categories';
import { Vec2 } from 'js/map/common/types';

// Each category's cell in static/images/atlases/points.png, which py/svgs_to_atlas.py builds from
// images/atlases/points/def.json.
const POINTS_ATLAS = new Map<PointCategory, number>([
  // [point.svg, 0], // point.svg
  [PointCategory.LODGING_HUT_ALPINE, 1], // alpine_hut.svg
  [PointCategory.FACILITY_FIRE_BARBECUE, 2], // barbecue.svg
  // [bridge.svg, 3], // bridge.svg
  [PointCategory.LODGING_CAMP_SITE, 4], // camp_site.svg
  [PointCategory.NATURAL_CAVE_ENTRANCE, 5], // cave_entrance.svg
  [PointCategory.WATER_DRINKING, 6], // drinking_water.svg
  [PointCategory.FACILITY_FIRE_PIT, 7], // firepit.svg
  [PointCategory.INFORMATION_GUIDE_POST, 8], // guidepost.svg
  [PointCategory.NATURAL_MOUNTAIN_PASS, 9], // mountain_pass.svg
  [PointCategory.ACCESS_PARKING, 10], // parking.svg
  [PointCategory.NATURAL_PEAK, 11], // peak.svg
  [PointCategory.FACILITY_PICNIC_TABLE, 12], // picnic_table.svg
  [PointCategory.NATURAL_SADDLE, 13], // saddle.svg
  [PointCategory.FACILITY_SHELTER, 14], // shelter.svg
  [PointCategory.FACILITY_TOILETS, 15], // toilets.svg
  [PointCategory.ACCESS_TRAILHEAD, 16], // trailhead.svg
  [PointCategory.SIGHT_VIEWPOINT, 17], // viewpoint.svg
  [PointCategory.INFORMATION_VISITOR_CENTER, 18], // visitor_center.svg
  [PointCategory.NATURAL_VOLCANO, 19], // volcano.svg
  [PointCategory.NATURAL_WATERFALL, 20], // waterfall.svg
  [PointCategory.LODGING_HUT_WILDERNESS, 21], // wilderness_hut.svg
  [PointCategory.ACCESS_TRANSIT_AIRPORT, 22], // airport.svg
  [PointCategory.FACILITY_BICYCLE_REPAIR, 23], // bicycle_repair.svg
  [PointCategory.ACCESS_TRANSIT_BUS_STOP, 24], // bus_stop.svg
  [PointCategory.LODGING_CAMP_CARAVAN_SITE, 25], // caravan_site.svg
  [PointCategory.LODGING_ROOM_CHALET, 26], // chalet.svg
  [PointCategory.SAFETY_CLINIC, 27], // clinic.svg
  [PointCategory.RESUPPLY_CONVENIENCE, 28], // convenience.svg
  [PointCategory.SAFETY_DEFIBRILLATOR, 29], // defibrillator.svg
  [PointCategory.SAFETY_EMERGENCY_PHONE, 30], // emergency_phone.svg
  [PointCategory.ACCESS_TRANSIT_FERRY_TERMINAL, 31], // ferry_terminal.svg
  [PointCategory.RESUPPLY_FUEL, 32], // fuel.svg
  [PointCategory.LODGING_ROOM_GUEST_HOUSE, 33], // guest_house.svg
  [PointCategory.LODGING_HOSTEL, 34], // hostel.svg
  [PointCategory.NATURAL_HOT_SPRING, 35], // hot_spring.svg
  [PointCategory.LODGING_ROOM_HOTEL, 36], // hotel.svg
  [PointCategory.FACILITY_LAUNDRY, 37], // laundry.svg
  [PointCategory.LODGING_ROOM_MOTEL, 38], // motel.svg
  [PointCategory.SAFETY_MOUNTAIN_RESCUE, 39], // mountain_rescue.svg
  [PointCategory.SIGHT_OBSERVATION_TOWER, 40], // observation_tower.svg
  [PointCategory.RESUPPLY_OUTDOOR, 41], // outdoor.svg
  [PointCategory.SAFETY_PHARMACY, 42], // pharmacy.svg
  [PointCategory.RESUPPLY_POST_OFFICE, 43], // post_office.svg
  [PointCategory.INFORMATION_RANGER_STATION, 44], // ranger_station.svg
  [PointCategory.SIGHT_RUINS, 45], // ruins.svg
  [PointCategory.FACILITY_SHOWER, 46], // shower.svg
  [PointCategory.WATER_SPRING, 47], // spring.svg
  [PointCategory.ACCESS_TRANSIT_STATION, 48], // station.svg
  [PointCategory.RESUPPLY_SUPERMARKET, 49], // supermarket.svg
  [PointCategory.WATER_TAP, 50], // tap.svg
  [PointCategory.WATER_POINT, 51], // water_point.svg
  [PointCategory.CLIMBING_ROUTE, 52], // climbing_route.svg

  // Custom additions, do not remove
  // !!! This is a repeat of camp site
  [PointCategory.LODGING_CAMP_PITCH, 4], // camp_site.svg
  // !!! This is a repeat of picnic table
  [PointCategory.FACILITY_PICNIC_SITE, 12], // picnic_table.svg
]);
export const POINTS_ATLAS_SIZE = [8, 8] as Vec2;

/** Returns the category's cell in the points atlas, or the generic point's. */
export function pointsAtlasIndex(category: number): number {
  return POINTS_ATLAS.get(category) ?? 0;
}
