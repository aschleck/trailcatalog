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

  // Custom additions, do not remove
  // !!! This is a repeat of camp site
  [PointCategory.LODGING_CAMP_PITCH, 4], // camp_site.svg
  // !!! This is a repeat of picnic table
  [PointCategory.FACILITY_PICNIC_SITE, 12], // picnic_table.svg
]);
export const POINTS_ATLAS_SIZE = [8, 4] as Vec2;

/** Returns the category's cell in the points atlas, or the generic point's. */
export function pointsAtlasIndex(category: number): number {
  return POINTS_ATLAS.get(category) ?? 0;
}
