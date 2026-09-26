import { WayCategory } from 'java/org/trailcatalog/models/categories';
import { RgbaU32 } from 'js/map/common/types';
import { NATURE } from 'js/map/layers/mbtile_layer';
import { toProtomaps } from 'js/map/layers/protomaps_translation';
import { Style as MbtileStyle } from 'js/map/workers/mbtile_loader';
import { Z_OVERLAY_TRANSPORTATION, Z_USER_DATA } from 'js/map/z';

import { LineStyle, Style } from './workers/collection_loader';

type MbtileLayerStyle = MbtileStyle['layers'][number];
type MbtileMatch = MbtileLayerStyle['lines'][number]['filters'][number];

// Where the collection takes over drawing ways from the vector tiles.
const FROM_ZOOM = 10;

// The layers of NATURE that draw ways the collection also carries.
const WAY_LAYERS = new Set(['aeroway', 'transportation', 'waterway']);

// The categories the importer assigns for each OpenMapTiles class. A category names a subtree, so
// PATH would take every kind of path.
const CLASS_CATEGORIES = new Map<string, WayCategory[]>([
  ['motorway', [WayCategory.ROAD_MOTORWAY, WayCategory.ROAD_MOTORWAY_LINK]],
  ['trunk', [WayCategory.ROAD_TRUNK, WayCategory.ROAD_TRUNK_LINK]],
  ['primary', [WayCategory.ROAD_PRIMARY, WayCategory.ROAD_PRIMARY_LINK]],
  ['secondary', [WayCategory.ROAD_SECONDARY, WayCategory.ROAD_SECONDARY_LINK]],
  ['tertiary', [WayCategory.ROAD_TERTIARY, WayCategory.ROAD_TERTIARY_LINK]],
  ['minor', [
    WayCategory.ROAD_UNCLASSIFIED,
    WayCategory.ROAD_RESIDENTIAL,
    WayCategory.ROAD_LIVING_STREET,
  ]],
  ['service', [WayCategory.ROAD_SERVICE]],
  ['track', [WayCategory.ROAD_TRACK]],
  ['path', [WayCategory.PATH]],
  ['rail', [
    WayCategory.RAIL,
    WayCategory.RAIL_NARROW_GAUGE,
    WayCategory.RAIL_PRESERVED,
    WayCategory.RAIL_FUNICULAR,
  ]],
  ['transit', [
    WayCategory.RAIL_SUBWAY,
    WayCategory.RAIL_LIGHT_RAIL,
    WayCategory.RAIL_TRAM,
    WayCategory.RAIL_MONORAIL,
  ]],
  // A construction way whose construction=* named no class stays on the bare category, which no
  // class claims, so it draws as unbuilt rather than as the narrowest thing that matched.
  ['motorway_construction', [WayCategory.ROAD_CONSTRUCTION_MOTORWAY]],
  ['primary_construction', [WayCategory.ROAD_CONSTRUCTION_PRIMARY]],
  ['secondary_construction', [WayCategory.ROAD_CONSTRUCTION_SECONDARY]],
  ['minor_construction', [WayCategory.ROAD_CONSTRUCTION_MINOR]],
  ['runway', [WayCategory.AEROWAY_RUNWAY]],
  ['taxiway', [WayCategory.AEROWAY_TAXIWAY, WayCategory.AEROWAY_TAXILANE]],
  ['river', [WayCategory.WATERWAY_RIVER]],
  ['stream', [WayCategory.WATERWAY_STREAM]],
  ['canal', [WayCategory.WATERWAY_CANAL]],
]);

function categoriesFor(filters: MbtileMatch[]): WayCategory[] {
  const categories: WayCategory[] = [];
  for (const filter of filters) {
    if (filter.match !== 'string_in' || filter.key !== 'class') {
      throw new Error(`Only string_in on class replays against way categories, got ${filter.match}`);
    }
    for (const name of filter.value) {
      const mapped = CLASS_CATEGORIES.get(name);
      if (!mapped) {
        throw new Error(`Add a WayCategory for the OpenMapTiles class ${name}`);
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

// The path family, written against WayCategory rather than replayed out of an OpenMapTiles style,
// because OpenMapTiles names neither a sidewalk nor a piste and MapTiler draws none of this anyway.
// Bands match NATURE's transportation bands so the widths ramp with the roads, and nothing starts
// before zoom 11 because a whole wilderness of trails at that scale is a smear.
//
// Every rule is one flat color: the casing is the outer device pixel of the line (see
// line_program.ts#draw) and none of these is ever wide enough to hold anything inside it.
//
// A piste takes the trail's own style. It is a route over the ground the same way a trail is, and
// this is not a ski map, so nothing here needs to tell them apart.
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
    stipple: true,
    z: Z_OVERLAY_TRANSPORTATION - 0.45,
  },
  {
    filters: [{match: 'category_in', key: 'type', value: [WayCategory.PATH, WayCategory.PISTE]}],
    minZoom: 11,
    maxZoom: 12,
    fill: TRAIL_COLOR,
    stroke: TRAIL_COLOR,
    radius: 0.6,
    // Stippled because a solid hairline reads as a stream.
    stipple: true,
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
    stipple: true,
    z: Z_OVERLAY_TRANSPORTATION - 0.45,
  },
  {
    filters: [{match: 'category_in', key: 'type', value: [WayCategory.PATH, WayCategory.PISTE]}],
    minZoom: 12,
    maxZoom: 13,
    fill: TRAIL_COLOR,
    stroke: TRAIL_COLOR,
    radius: 0.6,
    stipple: true,
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
    stipple: true,
    z: Z_OVERLAY_TRANSPORTATION - 0.45,
  },
  {
    filters: [{match: 'category_in', key: 'type', value: [WayCategory.PATH, WayCategory.PISTE]}],
    minZoom: 13,
    maxZoom: 15,
    fill: TRAIL_COLOR,
    stroke: TRAIL_COLOR,
    radius: 0.6,
    stipple: true,
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
    stipple: true,
    z: Z_OVERLAY_TRANSPORTATION - 0.45,
  },
  {
    filters: [{match: 'category_in', key: 'type', value: [WayCategory.PATH, WayCategory.PISTE]}],
    minZoom: 15,
    maxZoom: 31,
    fill: TRAIL_COLOR,
    stroke: TRAIL_COLOR,
    radius: 1.2,
    stipple: true,
    z: Z_OVERLAY_TRANSPORTATION - 0.3,
  },
];

// The track rules MapTiler's basemap has no reason to carry, per NATURE transportation band, keyed
// by the band's minZoom. These stay in the mbtile style because track is a real OpenMapTiles class,
// so NATURE_WITH_TRACKS is still a style that would draw the tiles it claims to.
//
// A track draws TRACK_CORE_COLOR inside TRACK_COLOR once the band is wide enough to hold a core,
// which is past radius 1. The casing pixel is also where the shader fades the line's alpha out, so
// the border stays a soft hairline no matter how wide the track gets, and a paper map's double dash
// would take two line styles per way. A pale road in a dark border still reads as unpaved next to a
// solid green trail, which is the job.
//
// The z values continue NATURE's transportation ramp downward from service, so a service road's
// casing covers a track running into it and a track's covers a trail.
const TRACK_LINES = new Map<number, MbtileLayerStyle['lines']>([
  [11, [
    {
      filters: [{match: 'string_in', key: 'class', value: ['track']}],
      fill: TRACK_COLOR,
      stroke: TRACK_COLOR,
      radius: 0.5,
      stipple: true,
      z: Z_OVERLAY_TRANSPORTATION - 0.15,
    },
  ]],
  [12, [
    {
      filters: [{match: 'string_in', key: 'class', value: ['track']}],
      fill: TRACK_COLOR,
      stroke: TRACK_COLOR,
      radius: 0.6,
      stipple: true,
      z: Z_OVERLAY_TRANSPORTATION - 0.15,
    },
  ]],
  [13, [
    {
      filters: [{match: 'string_in', key: 'class', value: ['track']}],
      fill: TRACK_CORE_COLOR,
      stroke: TRACK_COLOR,
      radius: 1.8,
      stipple: true,
      z: Z_OVERLAY_TRANSPORTATION - 0.15,
    },
  ]],
  [15, [
    {
      filters: [{match: 'string_in', key: 'class', value: ['track']}],
      fill: TRACK_CORE_COLOR,
      stroke: TRACK_COLOR,
      radius: 2.4,
      stipple: true,
      z: Z_OVERLAY_TRANSPORTATION - 0.15,
    },
  ]],
]);

/**
 * Adds TRACK_LINES to the transportation bands that already exist, so the widths ramp with the
 * roads.
 */
function withTracks(style: MbtileStyle): MbtileStyle {
  const layers = style.layers.map(layer => {
    const lines = layer.layerName === 'transportation' ? TRACK_LINES.get(layer.minZoom) : undefined;
    if (!lines) {
      return layer;
    }

    // Prepended to keep NATURE's bottom of the ramp first ordering.
    return {...layer, lines: [...lines, ...layer.lines]};
  });
  return {layers};
}

export const NATURE_WITH_TRACKS: MbtileStyle = withTracks(NATURE);

// PATH_LINES first to keep the lowest z first, which is only cosmetic: it names categories no road,
// aeroway, or waterway rule can match, so nothing depends on which one findZoomedStyle reaches.
export const OSM_PATHS: Style = {
  lines: [...PATH_LINES, ...wayLines(NATURE_WITH_TRACKS)],
  polygons: [],
};

export const NATURE_WITHOUT_DETAILED_WAYS: MbtileStyle = withoutWayLines(NATURE);

// Translated after dropping the ways because withoutWayLines and wayLines both read OpenMapTiles
// layer names and classes.
export const NATURE_PROTOMAPS: MbtileStyle = toProtomaps(NATURE_WITHOUT_DETAILED_WAYS);

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
