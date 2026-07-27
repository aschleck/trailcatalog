import { WayCategory } from 'java/org/trailcatalog/models/categories';
import { RgbaU32 } from 'js/map/common/types';
import { NATURE } from 'js/map/layers/mbtile_layer';
import { Style as MbtileStyle } from 'js/map/workers/mbtile_loader';
import { Z_USER_DATA } from 'js/map/z';

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
  // The tiles split construction by the class it will become, the importer does not.
  ['motorway_construction', [WayCategory.ROAD_CONSTRUCTION]],
  ['primary_construction', [WayCategory.ROAD_CONSTRUCTION]],
  ['secondary_construction', [WayCategory.ROAD_CONSTRUCTION]],
  ['minor_construction', [WayCategory.ROAD_CONSTRUCTION]],
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

export const OSM_PATHS: Style = {
  lines: wayLines(NATURE),
  polygons: [],
};

export const NATURE_WITHOUT_DETAILED_WAYS: MbtileStyle = withoutWayLines(NATURE);

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
