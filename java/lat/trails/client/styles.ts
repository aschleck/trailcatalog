import { WayCategory } from 'java/org/trailcatalog/models/categories';
import { RgbaU32 } from 'js/map/common/types';
import { Z_OVERLAY_TRANSPORTATION, Z_USER_DATA } from 'js/map/z';

import { LineStyle, Style } from './workers/collection_loader';

// Colors, radii, and z offsets are lifted from the transportation layers of NATURE in
// mbtile_layer.ts, because this style stands in for those layers once the collection covers a
// zoom. Keep in sync with NATURE#transportation.
//
// The classes there are OpenMapTiles names, so each one becomes the set of WayCategory values the
// importer assigns for it. A category names a subtree, so PATH takes every kind of path.

const MOTORWAY = [WayCategory.ROAD_MOTORWAY, WayCategory.ROAD_MOTORWAY_LINK];
const TRUNK = [WayCategory.ROAD_TRUNK, WayCategory.ROAD_TRUNK_LINK];
const PRIMARY = [WayCategory.ROAD_PRIMARY, WayCategory.ROAD_PRIMARY_LINK];
const SECONDARY = [WayCategory.ROAD_SECONDARY, WayCategory.ROAD_SECONDARY_LINK];
const TERTIARY = [WayCategory.ROAD_TERTIARY, WayCategory.ROAD_TERTIARY_LINK];
// OpenMapTiles calls unclassified, residential, and living street minor.
const MINOR = [
  WayCategory.ROAD_UNCLASSIFIED,
  WayCategory.ROAD_RESIDENTIAL,
  WayCategory.ROAD_LIVING_STREET,
];
const SERVICE = [WayCategory.ROAD_SERVICE];
const CONSTRUCTION = [WayCategory.ROAD_CONSTRUCTION];
// Mainline rail, against the transit set that OpenMapTiles splits out.
const RAIL = [
  WayCategory.RAIL,
  WayCategory.RAIL_NARROW_GAUGE,
  WayCategory.RAIL_PRESERVED,
  WayCategory.RAIL_FUNICULAR,
];
const TRANSIT = [
  WayCategory.RAIL_SUBWAY,
  WayCategory.RAIL_LIGHT_RAIL,
  WayCategory.RAIL_TRAM,
  WayCategory.RAIL_MONORAIL,
];
const RUNWAY = [WayCategory.AEROWAY_RUNWAY];
const TAXIWAY = [WayCategory.AEROWAY_TAXIWAY, WayCategory.AEROWAY_TAXILANE];
const WATERWAY = [
  WayCategory.WATERWAY_RIVER,
  WayCategory.WATERWAY_STREAM,
  WayCategory.WATERWAY_CANAL,
];

function line(
    categories: number[],
    minZoom: number,
    maxZoom: number,
    fill: number,
    stroke: number,
    radius: number,
    z: number,
): LineStyle {
  return {
    filters: [{match: 'category_in', key: 'type', value: categories}],
    minZoom,
    maxZoom,
    fill: fill as RgbaU32,
    stroke: stroke as RgbaU32,
    radius,
    stipple: false,
    z,
  };
}

// Ordered so the first match wins, which means narrower classes come before the wider ones they
// would otherwise be swallowed by, and every band lists its members low to high the way the mbtile
// style does.
const ROADS: LineStyle[] = [
  // 10 to 11 draws only the classes that carry across a whole region.
  line([...SECONDARY, ...CONSTRUCTION], 10, 11, 0xA49A88FF, 0xA49A88FF, 0.5,
      Z_OVERLAY_TRANSPORTATION + 0.6),
  line(PRIMARY, 10, 11, 0x9B9180FF, 0x9B9180FF, 0.6, Z_OVERLAY_TRANSPORTATION + 0.75),
  line([...MOTORWAY, ...TRUNK], 10, 11, 0xB3ACA1FF, 0x8E8474FF, 0.8,
      Z_OVERLAY_TRANSPORTATION + 0.9),

  line([...RAIL, ...TRANSIT], 11, 12, 0xAAAAAAAA, 0xAAAAAAAA, 0.9,
      Z_OVERLAY_TRANSPORTATION + 0.15),
  line([...MINOR, ...CONSTRUCTION], 11, 12, 0xB2A998FF, 0xB2A998FF, 0.5,
      Z_OVERLAY_TRANSPORTATION + 0.3),
  line(TERTIARY, 11, 12, 0xD8D2C6FF, 0xACA291FF, 0.75, Z_OVERLAY_TRANSPORTATION + 0.45),
  line(SECONDARY, 11, 12, 0xE8E4DCFF, 0xA49A88FF, 0.95, Z_OVERLAY_TRANSPORTATION + 0.6),
  line(PRIMARY, 11, 12, 0xF5F3EFFF, 0x9B9180FF, 1.15, Z_OVERLAY_TRANSPORTATION + 0.75),
  line([...MOTORWAY, ...TRUNK], 11, 12, 0xFAF9F7FF, 0x8E8474FF, 1.4,
      Z_OVERLAY_TRANSPORTATION + 0.9),

  line([...RAIL, ...TRANSIT], 12, 13, 0xAAAAAAAA, 0xAAAAAAAA, 1,
      Z_OVERLAY_TRANSPORTATION + 0.15),
  line([...MINOR, ...CONSTRUCTION], 12, 13, 0xFFFFFFFF, 0xB2A998FF, 0.75,
      Z_OVERLAY_TRANSPORTATION + 0.3),
  line(TERTIARY, 12, 13, 0xFFFFFFFF, 0xB2A998FF, 1.15, Z_OVERLAY_TRANSPORTATION + 0.45),
  line(SECONDARY, 12, 13, 0xFCFBF9FF, 0xA49A88FF, 1.35, Z_OVERLAY_TRANSPORTATION + 0.6),
  line(PRIMARY, 12, 13, 0xFFFFFFFF, 0x9B9180FF, 1.7, Z_OVERLAY_TRANSPORTATION + 0.75),
  line([...MOTORWAY, ...TRUNK], 12, 13, 0xFFFFFFFF, 0x8E8474FF, 2.1,
      Z_OVERLAY_TRANSPORTATION + 0.9),

  line(SERVICE, 13, 15, 0xDFDAD0FF, 0xBCB4A5FF, 0.7, Z_OVERLAY_TRANSPORTATION),
  line([...RAIL, ...TRANSIT], 13, 15, 0xAAAAAAAA, 0xAAAAAAAA, 1,
      Z_OVERLAY_TRANSPORTATION + 0.15),
  line([...MINOR, ...CONSTRUCTION], 13, 15, 0xFFFFFFFF, 0xB2A998FF, 1.5,
      Z_OVERLAY_TRANSPORTATION + 0.3),
  line(TERTIARY, 13, 15, 0xF8F7F4FF, 0xACA291FF, 1.5, Z_OVERLAY_TRANSPORTATION + 0.45),
  line(SECONDARY, 13, 15, 0xFFFFFFFF, 0xA49A88FF, 1.5, Z_OVERLAY_TRANSPORTATION + 0.6),
  line(PRIMARY, 13, 15, 0xFFFFFFFF, 0x9B9180FF, 1.9, Z_OVERLAY_TRANSPORTATION + 0.75),
  line([...MOTORWAY, ...TRUNK], 13, 15, 0xFFFFFFFF, 0x8E8474FF, 2.4,
      Z_OVERLAY_TRANSPORTATION + 0.9),

  line(SERVICE, 15, 32, 0xF6F5F2FF, 0xBCB4A5FF, 1.5, Z_OVERLAY_TRANSPORTATION),
  line([...RAIL, ...TRANSIT], 15, 32, 0xAAAAAAAA, 0xAAAAAAAA, 1.2,
      Z_OVERLAY_TRANSPORTATION + 0.15),
  line([...MINOR, ...CONSTRUCTION], 15, 32, 0xFFFFFFFF, 0xB2A998FF, 2.2,
      Z_OVERLAY_TRANSPORTATION + 0.3),
  line(TERTIARY, 15, 32, 0xFFFFFFFF, 0xACA291FF, 2.5, Z_OVERLAY_TRANSPORTATION + 0.45),
  line(SECONDARY, 15, 32, 0xFFFFFFFF, 0xA49A88FF, 3, Z_OVERLAY_TRANSPORTATION + 0.6),
  line(PRIMARY, 15, 32, 0xFFFFFFFF, 0x9B9180FF, 3.6, Z_OVERLAY_TRANSPORTATION + 0.75),
  line([...MOTORWAY, ...TRUNK], 15, 32, 0xFFFFFFFF, 0x8E8474FF, 4.5,
      Z_OVERLAY_TRANSPORTATION + 0.9),
];

// An aerodrome is an area, and the collection carries no polygons, so the pavement underneath the
// runways is still the mbtile layer's job. See NATURE#aeroway.
const AEROWAYS: LineStyle[] = [
  line(RUNWAY, 11, 12, 0xF8F8FAFF, 0xCBD0DAFF, 1.5, Z_OVERLAY_TRANSPORTATION),
  line(RUNWAY, 12, 13, 0xF8F8FAFF, 0xCBD0DAFF, 3, Z_OVERLAY_TRANSPORTATION),
  line(TAXIWAY, 12, 13, 0xECEEF3FF, 0xD3D8E2FF, 1.5, Z_OVERLAY_TRANSPORTATION),
  line(RUNWAY, 13, 14, 0xF8F8FAFF, 0xCBD0DAFF, 4, Z_OVERLAY_TRANSPORTATION),
  line(TAXIWAY, 13, 14, 0xECEEF3FF, 0xD3D8E2FF, 2, Z_OVERLAY_TRANSPORTATION),
  line(RUNWAY, 14, 32, 0xF8F8FAFF, 0xCBD0DAFF, 6, Z_OVERLAY_TRANSPORTATION),
  line(TAXIWAY, 14, 32, 0xECEEF3FF, 0xD3D8E2FF, 3, Z_OVERLAY_TRANSPORTATION),
];

// See NATURE#waterway. Z_BASE_WATER is not exported, and the collection has no water polygons to
// sit under anyway, so these ride at the bottom of the transportation band.
const WATERWAYS: LineStyle[] = [
  line(WATERWAY, 10, 32, 0x7FC2E0FF, 0x7FC2E0FF, 0.5, Z_OVERLAY_TRANSPORTATION - 0.5),
];

/** Stands in for the OSM derived line layers of NATURE once the collection reaches a zoom. */
export const OSM_PATHS: Style = {
  lines: [...WATERWAYS, ...AEROWAYS, ...ROADS],
  polygons: [],
};

export const PUBLIC_LAND: Style = {
  lines: [],
  polygons: [
    {
      filters: [{match: 'string_equals', key: 'owner', value: 'BLM/BR'}],
      fill: 0xFFFF0088 as RgbaU32,
      z: Z_USER_DATA,
    },
    {
      filters: [{match: 'string_equals', key: 'owner', value: 'NPS'}],
      fill: 0x00FF0088 as RgbaU32,
      z: Z_USER_DATA,
    },
    {
      filters: [{match: 'string_equals', key: 'owner', value: 'USFS'}],
      fill: 0x0000FF88 as RgbaU32,
      z: Z_USER_DATA,
    },
    {
      filters: [{match: 'always'}],
      fill: 0xFF000088 as RgbaU32,
      z: Z_USER_DATA,
    },
  ],
};
