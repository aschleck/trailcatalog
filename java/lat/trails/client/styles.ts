import { aDescendsB, PointCategory, WayCategory } from 'java/org/trailcatalog/models/categories';
import { RgbaU32 } from 'js/map/common/types';
import { NATURE } from 'js/map/layers/mbtile_layer';
import { Style as MbtileStyle } from 'js/map/workers/mbtile_loader';
import { Z_OVERLAY_TRANSPORTATION } from 'js/map/z';

import { LineStyle, Style } from './workers/collection_loader';

type MbtileLayerStyle = MbtileStyle['layers'][number];
type MbtileMatch = MbtileLayerStyle['lines'][number]['filters'][number];

// Where the collection takes over drawing ways from the vector tiles.
const FROM_ZOOM = 10;

// The layers of NATURE that draw ways the collection also carries.
const WAY_LAYERS = new Set(['roads', 'water']);

// The categories the importer assigns for each protomaps kind_detail on a road and kind on a
// waterway, which are mostly the raw OSM value. A category names a subtree, so PATH would take
// every kind of path.
const KIND_CATEGORIES = new Map<string, WayCategory[]>([
  // Protomaps carries no roads under construction, so their categories ride along with the class
  // they'll become, which every rule naming that class also draws. A construction way whose
  // construction=* named no class stays on the bare category, which nothing claims, so it draws as
  // unbuilt rather than as the narrowest thing that matched.
  ['motorway', [WayCategory.ROAD_MOTORWAY, WayCategory.ROAD_CONSTRUCTION_MOTORWAY]],
  ['motorway_link', [WayCategory.ROAD_MOTORWAY_LINK]],
  ['trunk', [WayCategory.ROAD_TRUNK]],
  ['trunk_link', [WayCategory.ROAD_TRUNK_LINK]],
  ['primary', [WayCategory.ROAD_PRIMARY, WayCategory.ROAD_CONSTRUCTION_PRIMARY]],
  ['primary_link', [WayCategory.ROAD_PRIMARY_LINK]],
  ['secondary', [WayCategory.ROAD_SECONDARY, WayCategory.ROAD_CONSTRUCTION_SECONDARY]],
  ['secondary_link', [WayCategory.ROAD_SECONDARY_LINK]],
  ['tertiary', [WayCategory.ROAD_TERTIARY]],
  ['tertiary_link', [WayCategory.ROAD_TERTIARY_LINK]],
  ['residential', [WayCategory.ROAD_RESIDENTIAL, WayCategory.ROAD_CONSTRUCTION_MINOR]],
  ['unclassified', [WayCategory.ROAD_UNCLASSIFIED]],
  ['living_street', [WayCategory.ROAD_LIVING_STREET]],
  // highway=road imports as the bare ROAD category, and ROAD is the subtree of every road.
  ['road', []],
  ['service', [WayCategory.ROAD_SERVICE]],
  ['rail', [WayCategory.RAIL]],
  ['narrow_gauge', [WayCategory.RAIL_NARROW_GAUGE]],
  ['preserved', [WayCategory.RAIL_PRESERVED]],
  ['funicular', [WayCategory.RAIL_FUNICULAR]],
  ['subway', [WayCategory.RAIL_SUBWAY]],
  ['light_rail', [WayCategory.RAIL_LIGHT_RAIL]],
  ['tram', [WayCategory.RAIL_TRAM]],
  ['monorail', [WayCategory.RAIL_MONORAIL]],
  ['runway', [WayCategory.AEROWAY_RUNWAY]],
  ['taxiway', [WayCategory.AEROWAY_TAXIWAY, WayCategory.AEROWAY_TAXILANE]],
  ['river', [WayCategory.WATERWAY_RIVER]],
  ['stream', [WayCategory.WATERWAY_STREAM]],
  ['canal', [WayCategory.WATERWAY_CANAL]],
]);

function categoriesFor(filters: MbtileMatch[]): WayCategory[] {
  const categories: WayCategory[] = [];
  for (const filter of filters) {
    if (filter.match !== 'string_in' || (filter.key !== 'kind_detail' && filter.key !== 'kind')) {
      throw new Error(
          'Only string_in on kind or kind_detail replays against way categories, got '
              + JSON.stringify(filter));
    }
    for (const name of filter.value) {
      const mapped = KIND_CATEGORIES.get(name);
      if (!mapped) {
        throw new Error(`Add a WayCategory for the protomaps kind ${name}`);
      }
      categories.push(...mapped);
    }
  }
  return categories;
}

/** Replays the line styling of an mbtile style against way categories, from FROM_ZOOM up. */
function wayLines(style: MbtileStyle): LineStyle[] {
  const lines: LineStyle[] = [];
  for (const layer of style.layers) {
    if (!WAY_LAYERS.has(layer.layerName) || layer.maxZoom <= FROM_ZOOM) {
      continue;
    }

    for (const line of layer.lines) {
      lines.push({
        ...line,
        filters: [{match: 'category_in', key: 'type', value: categoriesFor(line.filters)}],
        minZoom: Math.max(layer.minZoom, FROM_ZOOM),
        maxZoom: layer.maxZoom,
      });
    }
  }
  return lines;
}

/**
 * Drops the lines wayLines took over, splitting a band that straddles FROM_ZOOM so they survive
 * underneath it.
 *
 * Polygons, points, and line texts stay, because the collection carries none of them: an aerodrome
 * is an area and a road name is a label.
 */
function withoutWayLines(style: MbtileStyle): MbtileStyle {
  const layers: MbtileLayerStyle[] = [];
  for (const layer of style.layers) {
    if (!WAY_LAYERS.has(layer.layerName) || layer.lines.length === 0) {
      layers.push(layer);
      continue;
    }

    if (layer.minZoom < FROM_ZOOM) {
      layers.push({...layer, maxZoom: Math.min(layer.maxZoom, FROM_ZOOM)});
    }
    if (layer.maxZoom > FROM_ZOOM) {
      const above = {...layer, minZoom: Math.max(layer.minZoom, FROM_ZOOM), lines: []};
      if (above.lineTexts.length > 0 || above.points.length > 0 || above.polygons.length > 0) {
        layers.push(above);
      }
    }
  }
  return {layers};
}

// Dark enough to read against landcover, which composites to about 0xBFD9A8 where the 40% alpha
// 0x72B948 wood fill lands on the base.
const TRAIL_COLOR = 0x2A6B3CFF as RgbaU32;

// TRAIL_COLOR lightened toward the landcover it sits on, because a city block of sidewalks has to
// read as texture while a trail still wins.
const SIDEWALK_COLOR = 0x74A183FF as RgbaU32;

// NATURE's service casing 0xBCB4A5 pushed toward yellow to say unpaved, and taken most of the way
// to black because it only ever gets the one device pixel at the edge of the line to say it.
const TRACK_COLOR = 0x4A3A1EFF as RgbaU32;

// The core inside a track's border. NATURE's service fill 0xF6F5F2 warmed toward TRACK_COLOR, so
// the core still says dirt.
const TRACK_CORE_COLOR = 0xEFE9DEFF as RgbaU32;

// A slate blue, so that a run reads as snow rather than as a trail, lighter than SIDEWALK_COLOR so
// it sits under both.
const PISTE_COLOR = 0x9AAABBFF as RgbaU32;

// The path family, written against WayCategory rather than replayed out of NATURE, because NATURE
// draws none of this and protomaps has no kind for a piste.
// Bands match NATURE's transportation bands so the widths ramp with the roads, and nothing starts
// before zoom 11 because a whole wilderness of trails at that scale is a smear.
//
// Every rule is one flat color: the casing is the outer device pixel of the line (see
// line_program.ts#draw) and none of these is ever wide enough to hold anything inside it.
//
// A piste draws fainter than a trail, as thin as a sidewalk, because a ski run without a highway=*
// on it is an open slope in summer and a resort has several times more of them than trails.
//
// The sidewalk rule comes first in every band because the first matching style wins and the trail
// rule names WayCategory.PATH, which is the subtree and so takes the sidewalks too.
const PATH_LINES: LineStyle[] = [
  {
    filters: [{
      match: 'category_in',
      key: 'type',
      value: [WayCategory.PATH_FOOTWAY_SIDEWALK, WayCategory.PATH_FOOTWAY_CROSSING],
    }],
    minZoom: 11,
    maxZoom: 12,
    fill: SIDEWALK_COLOR,
    stroke: SIDEWALK_COLOR,
    radius: 0.4,
    pattern: 'dashed',
    z: Z_OVERLAY_TRANSPORTATION - 0.45,
  },
  {
    filters: [{match: 'category_in', key: 'type', value: [WayCategory.PISTE]}],
    minZoom: 11,
    maxZoom: 12,
    fill: PISTE_COLOR,
    stroke: PISTE_COLOR,
    radius: 0.4,
    pattern: 'dashed',
    z: Z_OVERLAY_TRANSPORTATION - 0.45,
  },
  {
    filters: [{match: 'category_in', key: 'type', value: [WayCategory.PATH]}],
    minZoom: 11,
    maxZoom: 12,
    fill: TRAIL_COLOR,
    stroke: TRAIL_COLOR,
    radius: 0.6,
    // Dashed because a solid hairline reads as a stream.
    pattern: 'dashed',
    z: Z_OVERLAY_TRANSPORTATION - 0.3,
  },
  {
    filters: [{
      match: 'category_in',
      key: 'type',
      value: [WayCategory.PATH_FOOTWAY_SIDEWALK, WayCategory.PATH_FOOTWAY_CROSSING],
    }],
    minZoom: 12,
    maxZoom: 13,
    fill: SIDEWALK_COLOR,
    stroke: SIDEWALK_COLOR,
    radius: 0.4,
    pattern: 'dashed',
    z: Z_OVERLAY_TRANSPORTATION - 0.45,
  },
  {
    filters: [{match: 'category_in', key: 'type', value: [WayCategory.PISTE]}],
    minZoom: 12,
    maxZoom: 13,
    fill: PISTE_COLOR,
    stroke: PISTE_COLOR,
    radius: 0.4,
    pattern: 'dashed',
    z: Z_OVERLAY_TRANSPORTATION - 0.45,
  },
  {
    filters: [{match: 'category_in', key: 'type', value: [WayCategory.PATH]}],
    minZoom: 12,
    maxZoom: 13,
    fill: TRAIL_COLOR,
    stroke: TRAIL_COLOR,
    radius: 0.6,
    pattern: 'dashed',
    z: Z_OVERLAY_TRANSPORTATION - 0.3,
  },
  {
    filters: [{
      match: 'category_in',
      key: 'type',
      value: [WayCategory.PATH_FOOTWAY_SIDEWALK, WayCategory.PATH_FOOTWAY_CROSSING],
    }],
    minZoom: 13,
    maxZoom: 15,
    fill: SIDEWALK_COLOR,
    stroke: SIDEWALK_COLOR,
    radius: 0.5,
    pattern: 'dashed',
    z: Z_OVERLAY_TRANSPORTATION - 0.45,
  },
  {
    filters: [{match: 'category_in', key: 'type', value: [WayCategory.PISTE]}],
    minZoom: 13,
    maxZoom: 15,
    fill: PISTE_COLOR,
    stroke: PISTE_COLOR,
    radius: 0.5,
    pattern: 'dashed',
    z: Z_OVERLAY_TRANSPORTATION - 0.45,
  },
  {
    filters: [{match: 'category_in', key: 'type', value: [WayCategory.PATH]}],
    minZoom: 13,
    maxZoom: 15,
    fill: TRAIL_COLOR,
    stroke: TRAIL_COLOR,
    radius: 0.6,
    pattern: 'dashed',
    z: Z_OVERLAY_TRANSPORTATION - 0.3,
  },
  {
    filters: [{
      match: 'category_in',
      key: 'type',
      value: [WayCategory.PATH_FOOTWAY_SIDEWALK, WayCategory.PATH_FOOTWAY_CROSSING],
    }],
    minZoom: 15,
    maxZoom: 31,
    fill: SIDEWALK_COLOR,
    stroke: SIDEWALK_COLOR,
    radius: 0.8,
    pattern: 'dashed',
    z: Z_OVERLAY_TRANSPORTATION - 0.45,
  },
  {
    filters: [{match: 'category_in', key: 'type', value: [WayCategory.PISTE]}],
    minZoom: 15,
    maxZoom: 31,
    fill: PISTE_COLOR,
    stroke: PISTE_COLOR,
    radius: 0.8,
    pattern: 'dashed',
    z: Z_OVERLAY_TRANSPORTATION - 0.45,
  },
  {
    filters: [{match: 'category_in', key: 'type', value: [WayCategory.PATH]}],
    minZoom: 15,
    maxZoom: 31,
    fill: TRAIL_COLOR,
    stroke: TRAIL_COLOR,
    radius: 1.2,
    pattern: 'dashed',
    z: Z_OVERLAY_TRANSPORTATION - 0.3,
  },
];

// The lifts a person rides. Drag lifts, freight, and stations draw nothing, so they neither clutter
// the map nor route.
//
// The hand-pulled baskets that carry a trail over a river are in here too, so a route only crosses
// one from an end on it, even though they're free and the trail depends on them. OSM tags them
// aerialway=cable_car or zip_line like any ticketed lift, and nothing else on the way reliably sets
// them apart: fee=no is rare, and hiking route relations also run over gondolas and chair lifts.
// Walbran Creek Cable Car on the West Coast Trail is way 472864003. One that also carries a
// highway=* imports as that highway, see ExtractWays, and so draws and routes as a trail.
const RIDDEN_AERIALWAYS = [
  WayCategory.AERIALWAY_CABLE_CAR,
  WayCategory.AERIALWAY_GONDOLA,
  WayCategory.AERIALWAY_MIXED_LIFT,
  WayCategory.AERIALWAY_CHAIR_LIFT,
  WayCategory.AERIALWAY_ZIP_LINE,
];

const AERIALWAY_COLOR = 0x8E8E8EFF as RgbaU32;

// Above every road, because a lift passes over whatever is under it, but narrower than the trail
// in each of PATH_LINES' bands so that it never outweighs one.
const AERIALWAY_LINES: LineStyle[] = [
  {
    filters: [{match: 'category_in', key: 'type', value: RIDDEN_AERIALWAYS}],
    minZoom: 12,
    maxZoom: 15,
    fill: AERIALWAY_COLOR,
    stroke: AERIALWAY_COLOR,
    radius: 0.5,
    pattern: 'ticks',
    z: Z_OVERLAY_TRANSPORTATION + 0.95,
  },
  {
    filters: [{match: 'category_in', key: 'type', value: RIDDEN_AERIALWAYS}],
    minZoom: 15,
    maxZoom: 31,
    fill: AERIALWAY_COLOR,
    stroke: AERIALWAY_COLOR,
    radius: 0.8,
    pattern: 'ticks',
    z: Z_OVERLAY_TRANSPORTATION + 0.95,
  },
];

// The importer files a route=ferry way as WATERWAY_FERRY, and NATURE has no class for it. Dashed,
// the way a paper map draws a ferry, so that it doesn't read as a road across the water.
const FERRY_COLOR = 0x2F6FA8FF as RgbaU32;

const FERRY_LINES: LineStyle[] = [
  {
    filters: [{match: 'category_in', key: 'type', value: [WayCategory.WATERWAY_FERRY]}],
    minZoom: 10,
    maxZoom: 15,
    fill: FERRY_COLOR,
    stroke: FERRY_COLOR,
    radius: 0.6,
    pattern: 'dashed',
    z: Z_OVERLAY_TRANSPORTATION - 0.5,
  },
  {
    filters: [{match: 'category_in', key: 'type', value: [WayCategory.WATERWAY_FERRY]}],
    minZoom: 15,
    maxZoom: 31,
    fill: FERRY_COLOR,
    stroke: FERRY_COLOR,
    radius: 1,
    pattern: 'dashed',
    z: Z_OVERLAY_TRANSPORTATION - 0.5,
  },
];

// The tracks, which NATURE leaves to the collection, in NATURE's transportation bands so the widths
// ramp with the roads.
//
// A track draws TRACK_CORE_COLOR inside TRACK_COLOR once the band is wide enough to hold a core,
// which is past radius 1. The casing pixel is also where the shader fades the line's alpha out, so
// the border stays a soft hairline no matter how wide the track gets, and a paper map's double dash
// would take two line styles per way. A pale road in a dark border still reads as unpaved next to a
// solid green trail, which is the job.
//
// The z values continue NATURE's transportation ramp downward from service, so a service road's
// casing covers a track running into it and a track's covers a trail.
const TRACK_LINES: LineStyle[] = [
  {
    filters: [{match: 'category_in', key: 'type', value: [WayCategory.ROAD_TRACK]}],
    minZoom: 11,
    maxZoom: 12,
    fill: TRACK_COLOR,
    stroke: TRACK_COLOR,
    radius: 0.5,
    pattern: 'dashed',
    z: Z_OVERLAY_TRANSPORTATION - 0.15,
  },
  {
    filters: [{match: 'category_in', key: 'type', value: [WayCategory.ROAD_TRACK]}],
    minZoom: 12,
    maxZoom: 13,
    fill: TRACK_COLOR,
    stroke: TRACK_COLOR,
    radius: 0.6,
    pattern: 'dashed',
    z: Z_OVERLAY_TRANSPORTATION - 0.15,
  },
  {
    filters: [{match: 'category_in', key: 'type', value: [WayCategory.ROAD_TRACK]}],
    minZoom: 13,
    maxZoom: 15,
    fill: TRACK_CORE_COLOR,
    stroke: TRACK_COLOR,
    radius: 1.8,
    pattern: 'dashed',
    z: Z_OVERLAY_TRANSPORTATION - 0.15,
  },
  {
    filters: [{match: 'category_in', key: 'type', value: [WayCategory.ROAD_TRACK]}],
    minZoom: 15,
    maxZoom: 31,
    fill: TRACK_CORE_COLOR,
    stroke: TRACK_COLOR,
    radius: 2.4,
    pattern: 'dashed',
    z: Z_OVERLAY_TRANSPORTATION - 0.15,
  },
];

// PATH_LINES first to keep the lowest z first, which is only cosmetic: it names categories no road,
// aeroway, or waterway rule can match, so nothing depends on which one findZoomedStyle reaches.
export const OSM_WAYS: Style = {
  lines: [
    ...PATH_LINES,
    ...wayLines(NATURE),
    ...TRACK_LINES,
    ...AERIALWAY_LINES,
    ...FERRY_LINES,
  ],
  points: [],
  polygons: [],
};

// What the Ways layer offers to show, by the top level OSM key each one imports from, except that
// highway=* splits into the three a hiker tells apart. Ferries come under waterways because the
// importer files route=ferry as WATERWAY_FERRY.
export const WAY_KINDS: ReadonlyArray<{key: string; label: string; category: WayCategory}> = [
  {key: 'aerialways', label: 'Aerialways', category: WayCategory.AERIALWAY},
  {key: 'aeroways', label: 'Aeroways', category: WayCategory.AEROWAY},
  {key: 'paths', label: 'Paths', category: WayCategory.PATH},
  {key: 'pistes', label: 'Pistes', category: WayCategory.PISTE},
  {key: 'railways', label: 'Railways', category: WayCategory.RAIL},
  {key: 'roads', label: 'Roads', category: WayCategory.ROAD},
  {key: 'waterways', label: 'Waterways', category: WayCategory.WATERWAY},
];

/**
 * Narrows OSM_WAYS to the ways descending from the categories. The loader drops a way no line
 * styles, so the rest also leave the index and stop catching the drawing tools.
 */
export function osmWaysOf(categories: WayCategory[]): Style {
  const lines = [];
  for (const line of OSM_WAYS.lines) {
    const filters = line.filters.map(filter =>
        filter.match === 'category_in'
            ? {...filter, value: filter.value.filter(v => categories.some(c => aDescendsB(v, c)))}
            : filter);
    if (filters.every(filter => filter.match !== 'category_in' || filter.value.length > 0)) {
      lines.push({...line, filters});
    }
  }
  return {lines, points: [], polygons: OSM_WAYS.polygons};
}

// What the Nodes layer offers to show
export const NODE_KINDS:
    ReadonlyArray<{key: string; label: string; category: PointCategory; hidden?: boolean}> = [
  {key: 'climbing', label: 'Climbing routes', category: PointCategory.CLIMBING},
  {key: 'facilities', label: 'Facilities', category: PointCategory.FACILITY},
  {key: 'information', label: 'Information', category: PointCategory.INFORMATION},
  {key: 'lodging', label: 'Lodging', category: PointCategory.LODGING},
  {key: 'natural', label: 'Natural features', category: PointCategory.NATURAL},
  {key: 'parking', label: 'Parking', category: PointCategory.ACCESS_PARKING},
  {key: 'resupply', label: 'Resupply', category: PointCategory.RESUPPLY},
  {key: 'safety', label: 'Safety', category: PointCategory.SAFETY},
  {key: 'sights', label: 'Sights', category: PointCategory.SIGHT},
  {key: 'trailheads', label: 'Trailheads', category: PointCategory.ACCESS_TRAILHEAD},
  {key: 'transit', label: 'Transit', category: PointCategory.ACCESS_TRANSIT, hidden: true},
  {key: 'water', label: 'Water', category: PointCategory.WATER},
];

export const NATURE_WITHOUT_DETAILED_WAYS: MbtileStyle = withoutWayLines(NATURE);

// What the basemap layer offers to label, by the protomaps layers each one's text comes from.
// Points in the basemap style only draw text, so dropping a layer's points and lineTexts takes
// all of its labels.
export const BASEMAP_LABEL_KINDS:
    ReadonlyArray<{key: string; label: string; layerNames: string[]}> = [
  {key: 'place_labels', label: 'Place labels', layerNames: ['places', 'pois']},
  {key: 'water_labels', label: 'Water labels', layerNames: ['water']},
  {key: 'way_labels', label: 'Way labels', layerNames: ['roads']},
];

/** Narrows NATURE_WITHOUT_DETAILED_WAYS to the boundaries and the labels in the protomaps layers named. */
export function basemapOf(boundaries: boolean, labeled: ReadonlySet<string>): MbtileStyle {
  const unlabeled = new Set(
      BASEMAP_LABEL_KINDS.flatMap(({layerNames}) => layerNames).filter(name => !labeled.has(name)));
  const layers = [];
  for (const layer of NATURE_WITHOUT_DETAILED_WAYS.layers) {
    if (!boundaries && layer.layerName === 'boundaries') {
      continue;
    }
    let polygons = layer.polygons;
    if (!boundaries) {
      // The park outlines are strokes on landuse polygons, the only basemap polygons with one.
      polygons = polygons
          .filter(polygon => polygon.fill !== 0)
          .map(polygon => ({...polygon, stroke: 0 as RgbaU32, strokeRadius: 0}));
    }
    const keepLabels = !unlabeled.has(layer.layerName);
    layers.push({
      ...layer,
      lineTexts: keepLabels ? layer.lineTexts : [],
      points: keepLabels ? layer.points : [],
      polygons,
    });
  }
  return {layers};
}
