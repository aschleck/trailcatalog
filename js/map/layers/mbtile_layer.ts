import { S2LatLng, S2LatLngRect } from 'java/org/trailcatalog/s2';
import { checkExhaustive, checkExists } from 'external/dev_april_corgi+/js/common/asserts';
import { HashMap, HashSet } from 'external/dev_april_corgi+/js/common/collections';
import { Task } from 'external/dev_april_corgi+/js/common/queued_worker_pool';
import { getLanguage } from 'external/dev_april_corgi+/js/server/ssr_aware';

import { projectS2LatLng, ScreenProjection, SphericalCone } from '../camera';
import { Copyright, RgbaU32, TileId } from '../common/types';
import { Layer } from '../layer';
import { GLYPHER } from '../rendering/glypher';
import { Planner } from '../rendering/planner';
import { Drawable } from '../rendering/program';
import { Renderer } from '../rendering/renderer';
import { loaderCount, PoolClient, sharedPool } from '../workers/client_pool';
import { Initialize as LoaderInitialize, Label, LoadResponse, QueryableFeature, Request as LoaderRequest, Response as LoaderResponse, Style, ValueType } from '../workers/mbtile_loader';
import { Command as FetcherCommand, Initialize as FetcherInitialize, LoadTileCommand, Request as FetcherRequest } from '../workers/xyz_data_fetcher';
import { Z_BASE_SATELLITE, Z_BASE_TERRAIN, Z_BASE_WATER, Z_OVERLAY_TERRAIN, Z_OVERLAY_TEXT, Z_OVERLAY_TRANSPORTATION } from '../z';

import { compareLabels, LabelCandidate, LabelPlacer } from './label_placer';
import { Cap } from './polar_cap_layer';

interface LoadedTile {
  drawables: Drawable[];
  glGeometryBuffer: WebGLBuffer;
  glIndexBuffer: WebGLBuffer;
  labelKeys: string[];
  queryable: QueryableFeature[];
}

interface IndexedLabel extends LabelCandidate {
  owners: Set<string>;
}

function tileKey(id: TileId): string {
  return `${id.zoom},${id.x},${id.y}`;
}

// Quantize world coords so two tiles at different zooms projecting the same lat/lng bucket the
// same key. MVT rounding error at zoom Z is ~1/(2^(Z+12)) world units; across adjacent zoom
// transitions (e.g. 7↔10), the worst-case diff is ~2e-6 world units. 1/0x40000 (~3.8e-6, ≈76m at
// equator) is coarse enough to absorb that error but fine enough that distinct point features
// stay distinct.
function labelKey(label: Label): string {
  const cx = Math.round(label.center[0] * 0x40000);
  const cy = Math.round(label.center[1] * 0x40000);
  return `${label.graphemes.join('')}|${cx},${cy}`;
}

const PREFERRED_LANGUAGE = getLanguage().split('-')[0];

const ICE_FILL = 0xFFFFFF80 as RgbaU32;
const WATER_FILL = 0x7FC2E0FF as RgbaU32;

// What PolarCapLayer draws past the tiles' reach, as the basemap would: the Arctic Ocean and the
// Antarctic ice sheet
export const ARCTIC_CAP: Cap = {fill: WATER_FILL, z: Z_BASE_WATER + 0.1};
export const ANTARCTIC_CAP: Cap = {fill: ICE_FILL, z: Z_BASE_TERRAIN + 0.5};

// TODO(april): we should glaciate the contours if it looks good
type LineTextStyle = Style['layers'][number]['lineTexts'][number];

// Heights on the bold contours, every tenth line, in their color. The stroke is the clear color
// so it breaks the line under the text.
const INDEX_CONTOUR_LABEL: LineTextStyle = {
  filters: [{
    match: 'greater_than',
    key: 'nth_line',
    value: 5,
  }],
  preferred: 'height',
  fallback: 'height',
  fill: 0x8A6E4BFF as RgbaU32,
  stroke: 0xF4F0E8FF as RgbaU32,
  scale: 0.45,
  spacingPx: 512,
  // Steep slopes pack index contours a few pixels apart, so labels keep their distance from each
  // other rather than labeling every line
  padPx: 24,
  uphill: true,
  z: Z_OVERLAY_TERRAIN,
};

const GLACIER_INDEX_CONTOUR_LABEL: LineTextStyle = {
  ...INDEX_CONTOUR_LABEL,
  filters: [
    ...INDEX_CONTOUR_LABEL.filters,
    {
      match: 'number_equals',
      key: 'glacier',
      value: 1,
    },
  ],
  fill: 0x048AB9FF as RgbaU32,
};

export const CONTOURS_FEET: Readonly<Style> = {
  layers: [
    {
      layerName: 'contour_ft',
      minZoom: 0,
      maxZoom: 13,
      lineTexts: [],
      lines: [
        {
          filters: [{
            match: 'greater_than',
            key: 'nth_line',
            value: 2,
          }, {
            match: 'number_equals',
            key: 'glacier',
            value: 1,
          }],
          fill: 0x048AB960 as RgbaU32,
          stroke: 0x048AB960 as RgbaU32,
          radius: 0.5,
          pattern: 'solid',
          z: Z_OVERLAY_TERRAIN,
        },
        {
          filters: [{
            match: 'greater_than',
            key: 'nth_line',
            value: 2,
          }],
          fill: 0x8A6E4B50 as RgbaU32,
          stroke: 0x8A6E4B50 as RgbaU32,
          radius: 0.5,
          pattern: 'solid',
          z: Z_OVERLAY_TERRAIN,
        },
      ],
      points: [],
      polygons: [],
    },
    {
      layerName: 'contour_ft',
      minZoom: 13,
      maxZoom: 14,
      lineTexts: [GLACIER_INDEX_CONTOUR_LABEL, INDEX_CONTOUR_LABEL],
      lines: [
        {
          filters: [{
            match: 'greater_than',
            key: 'nth_line',
            value: 5,
          }, {
            match: 'number_equals',
            key: 'glacier',
            value: 1,
          }],
          fill: 0x048AB9A0 as RgbaU32,
          stroke: 0x048AB9A0 as RgbaU32,
          radius: 0.5,
          pattern: 'solid',
          z: Z_OVERLAY_TERRAIN,
        },
        {
          filters: [{
            match: 'greater_than',
            key: 'nth_line',
            value: 5,
          }],
          fill: 0x8A6E4B90 as RgbaU32,
          stroke: 0x8A6E4B90 as RgbaU32,
          radius: 0.5,
          pattern: 'solid',
          z: Z_OVERLAY_TERRAIN,
        },
      ],
      points: [],
      polygons: [],
    },
    {
      layerName: 'contour_ft',
      minZoom: 14,
      maxZoom: 31,
      lineTexts: [GLACIER_INDEX_CONTOUR_LABEL, INDEX_CONTOUR_LABEL],
      lines: [
        {
          filters: [{
            match: 'greater_than',
            key: 'nth_line',
            value: 5,
          }, {
            match: 'number_equals',
            key: 'glacier',
            value: 1,
          }],
          fill: 0x048AB9A0 as RgbaU32,
          stroke: 0x048AB9A0 as RgbaU32,
          radius: 0.75,
          pattern: 'solid',
          z: Z_OVERLAY_TERRAIN,
        },
        {
          filters: [{
            match: 'greater_than',
            key: 'nth_line',
            value: 5,
          }],
          fill: 0x8A6E4B90 as RgbaU32,
          stroke: 0x8A6E4B90 as RgbaU32,
          radius: 0.75,
          pattern: 'solid',
          z: Z_OVERLAY_TERRAIN,
        },
        {
          filters: [{
            match: 'number_equals',
            key: 'glacier',
            value: 1,
          }],
          fill: 0x048AB960 as RgbaU32,
          stroke: 0x048AB960 as RgbaU32,
          radius: 0.5,
          pattern: 'solid',
          z: Z_OVERLAY_TERRAIN,
        },
        {
          filters: [],
          fill: 0x8A6E4B50 as RgbaU32,
          stroke: 0x8A6E4B50 as RgbaU32,
          radius: 0.5,
          pattern: 'solid',
          z: Z_OVERLAY_TERRAIN,
        },
      ],
      points: [],
      polygons: [],
    },
  ],
};

// Draws Macrostrat's geologic units in the color each source map assigned them.
// https://tiles.macrostrat.org/
export const MACROSTRAT: Readonly<Style> = {
  layers: [
    {
      layerName: 'units',
      minZoom: 0,
      maxZoom: 31,
      lineTexts: [],
      lines: [],
      points: [],
      polygons: [
        {
          filters: [],
          fill: 0x99999980 as RgbaU32,
          fillKey: 'color',
          queryable: true,
          stroke: 0x00000030 as RgbaU32,
          strokeRadius: 0.5,
          strokePattern: 'solid',
          // over imagery, under contours and roads
          z: Z_BASE_SATELLITE + 0.5,
        },
      ],
    },
    {
      layerName: 'lines',
      minZoom: 0,
      maxZoom: 31,
      lineTexts: [],
      lines: [
        {
          filters: [{
            match: 'string_in',
            key: 'type',
            value: [
              'detachment fault',
              'fault',
              'normal fault',
              'reverse fault',
              'strike-slip fault',
              'thrust fault',
            ],
          }],
          fill: 0x2B1B17D0 as RgbaU32,
          stroke: 0x2B1B17D0 as RgbaU32,
          radius: 0.75,
          pattern: 'solid',
          z: Z_BASE_SATELLITE + 0.6,
        },
      ],
      points: [],
      polygons: [],
    },
  ],
};

export const CONTOURS_METERS: Readonly<Style> = {
  layers: [
    {
      layerName: 'contour',
      minZoom: 0,
      maxZoom: 13,
      lineTexts: [],
      lines: [
        {
          filters: [{
            match: 'greater_than',
            key: 'nth_line',
            value: 2,
          }, {
            match: 'number_equals',
            key: 'glacier',
            value: 1,
          }],
          fill: 0x048AB960 as RgbaU32,
          stroke: 0x048AB960 as RgbaU32,
          radius: 0.5,
          pattern: 'solid',
          z: Z_OVERLAY_TERRAIN,
        },
        {
          filters: [{
            match: 'greater_than',
            key: 'nth_line',
            value: 2,
          }],
          fill: 0x8A6E4B50 as RgbaU32,
          stroke: 0x8A6E4B50 as RgbaU32,
          radius: 0.5,
          pattern: 'solid',
          z: Z_OVERLAY_TERRAIN,
        },
      ],
      points: [],
      polygons: [],
    },
    {
      layerName: 'contour',
      minZoom: 13,
      maxZoom: 14,
      lineTexts: [GLACIER_INDEX_CONTOUR_LABEL, INDEX_CONTOUR_LABEL],
      lines: [
        {
          filters: [{
            match: 'greater_than',
            key: 'nth_line',
            value: 5,
          }, {
            match: 'number_equals',
            key: 'glacier',
            value: 1,
          }],
          fill: 0x048AB9A0 as RgbaU32,
          stroke: 0x048AB9A0 as RgbaU32,
          radius: 0.75,
          pattern: 'solid',
          z: Z_OVERLAY_TERRAIN,
        },
        {
          filters: [{
            match: 'greater_than',
            key: 'nth_line',
            value: 5,
          }],
          fill: 0x8A6E4B90 as RgbaU32,
          stroke: 0x8A6E4B90 as RgbaU32,
          radius: 0.75,
          pattern: 'solid',
          z: Z_OVERLAY_TERRAIN,
        },
        {
          filters: [{
            match: 'number_equals',
            key: 'nth_line',
            value: 2,
          }, {
            match: 'number_equals',
            key: 'glacier',
            value: 1,
          }],
          fill: 0x048AB960 as RgbaU32,
          stroke: 0x048AB960 as RgbaU32,
          radius: 0.5,
          pattern: 'solid',
          z: Z_OVERLAY_TERRAIN,
        },
        {
          filters: [{
            match: 'number_equals',
            key: 'nth_line',
            value: 2,
          }],
          fill: 0x8A6E4B50 as RgbaU32,
          stroke: 0x8A6E4B50 as RgbaU32,
          radius: 0.5,
          pattern: 'solid',
          z: Z_OVERLAY_TERRAIN,
        },
      ],
      points: [],
      polygons: [],
    },
    {
      layerName: 'contour',
      minZoom: 14,
      maxZoom: 31,
      lineTexts: [GLACIER_INDEX_CONTOUR_LABEL, INDEX_CONTOUR_LABEL],
      lines: [
        {
          filters: [{
            match: 'greater_than',
            key: 'nth_line',
            value: 5,
          }, {
            match: 'number_equals',
            key: 'glacier',
            value: 1,
          }],
          fill: 0x048AB9A0 as RgbaU32,
          stroke: 0x048AB9A0 as RgbaU32,
          radius: 0.75,
          pattern: 'solid',
          z: Z_OVERLAY_TERRAIN,
        },
        {
          filters: [{
            match: 'greater_than',
            key: 'nth_line',
            value: 5,
          }],
          fill: 0x8A6E4B90 as RgbaU32,
          stroke: 0x8A6E4B90 as RgbaU32,
          radius: 0.75,
          pattern: 'solid',
          z: Z_OVERLAY_TERRAIN,
        },
        {
          filters: [{
            match: 'number_equals',
            key: 'glacier',
            value: 1,
          }],
          fill: 0x048AB960 as RgbaU32,
          stroke: 0x048AB960 as RgbaU32,
          radius: 0.5,
          pattern: 'solid',
          z: Z_OVERLAY_TERRAIN,
        },
        {
          filters: [],
          fill: 0x8A6E4B50 as RgbaU32,
          stroke: 0x8A6E4B50 as RgbaU32,
          radius: 0.5,
          pattern: 'solid',
          z: Z_OVERLAY_TERRAIN,
        },
      ],
      points: [],
      polygons: [],
    },
  ],
};

type PointStyle = Style['layers'][number]['points'][number];

// Place names get smaller and lighter with the place, so a city reads as more than its
// neighborhoods at a glance. Neighborhoods are gray spaced capitals, a different kind of name
// rather than a smaller town. The z order follows, so a city never loses its space to a part of
// itself.
// A city whose min_zoom is under 7 is one protomaps labels by zoom 7, like San Francisco and
// Oakland but not Daly City, which protomaps also calls a city.
const MAJOR_CITY_LABEL: PointStyle = {
  filters: [
    {match: 'string_in', key: 'kind_detail', value: ['city']},
    {match: 'less_than', key: 'min_zoom', value: 7},
  ],
  textFill: 0x2B2B2BFF as RgbaU32,
  textStroke: 0xEFEFEFFF as RgbaU32,
  textScale: 0.6,
  z: Z_OVERLAY_TEXT + 0.3,
};

const CITY_LABEL: PointStyle = {
  filters: [{match: 'string_in', key: 'kind_detail', value: ['city']}],
  textFill: 0x2B2B2BFF as RgbaU32,
  textStroke: 0xEFEFEFFF as RgbaU32,
  textScale: 0.52,
  z: Z_OVERLAY_TEXT + 0.28,
};

const TOWN_LABEL: PointStyle = {
  filters: [{match: 'string_in', key: 'kind_detail', value: ['town']}],
  textFill: 0x3D3D3DFF as RgbaU32,
  textStroke: 0xEFEFEFFF as RgbaU32,
  textScale: 0.48,
  z: Z_OVERLAY_TEXT + 0.25,
};

const VILLAGE_LABEL: PointStyle = {
  filters: [{match: 'string_in', key: 'kind_detail', value: ['village']}],
  textFill: 0x505050FF as RgbaU32,
  textStroke: 0xEFEFEFFF as RgbaU32,
  textScale: 0.44,
  z: Z_OVERLAY_TEXT + 0.2,
};

// Under water and park names, which say more about where a trail goes. Protomaps files the big
// named parts of a city, like Noe Valley, as quarters.
const SUBURB_LABEL: PointStyle = {
  filters: [{match: 'string_in', key: 'kind_detail', value: ['quarter', 'suburb']}],
  textFill: 0x6E6A64FF as RgbaU32,
  textStroke: 0xEFEFEFFF as RgbaU32,
  textScale: 0.38,
  caps: true,
  z: Z_OVERLAY_TEXT + 0.06,
};

const NEIGHBOURHOOD_LABEL: PointStyle = {
  ...SUBURB_LABEL,
  filters: [{match: 'string_in', key: 'kind_detail', value: ['neighbourhood']}],
  textScale: 0.34,
  z: Z_OVERLAY_TEXT + 0.05,
};

/**
 * Narrows a style to what protomaps would label before the zoom, because its min_zoom on a place
 * or a park is the zoom the label should first appear at.
 */
function rankedUnder(style: PointStyle, zoom: number): PointStyle {
  return {
    ...style,
    filters: [...style.filters, {match: 'less_than', key: 'min_zoom', value: zoom}],
  };
}

// The national parks and wildernesses. Protomaps files most national parks and every wilderness
// under nature_reserve, Mount Rainier National Park and Tatoosh Wilderness among them, so this
// also takes the state forests and wildlife areas it holds.
const PARKS = ['national_park', 'nature_reserve', 'protected_area'];

// Quieter than the place names, so a park reads as a region and not as a town.
const PARK_LABEL: PointStyle = {
  filters: [{match: 'string_in', key: 'kind', value: PARKS}],
  textFill: 0x3F7A4AFF as RgbaU32,
  textStroke: 0xEFEFEFFF as RgbaU32,
  textScale: 0.44,
  wrapGraphemes: 14,
  z: Z_OVERLAY_TEXT + 0.1,
};

type PolygonStyle = Style['layers'][number]['polygons'][number];

// TODO(april): this looks gross at the nortern tip of Greenland
const PARK_OUTLINE: PolygonStyle = {
  filters: [{match: 'string_in', key: 'kind', value: PARKS}],
  fill: 0 as RgbaU32,
  stroke: 0x13653288 as RgbaU32,
  strokeRadius: 1,
  strokePattern: 'solid',
  z: Z_BASE_TERRAIN + 0.75,
};

// Only from 10 in, because under that a city park is a speck and the lower zooms are where the
// TODO about Greenland bites.
const CITY_PARK_FILL: PolygonStyle = {
  filters: [{match: 'string_in', key: 'kind', value: ['park']}],
  fill: 0x8CC96A70 as RgbaU32,
  stroke: 0 as RgbaU32,
  strokeRadius: 0,
  strokePattern: 'solid',
  z: Z_BASE_TERRAIN + 0.75,
};

// Draws protomaps v4 tiles. Several entries can share a layer, like the airport and road rules
// that both draw roads, because the loader applies every band that holds the zoom.
// https://docs.protomaps.com/basemaps/layers
export const NATURE: Readonly<Style> = {
  layers: [
    // An airport is an area with pavement on it, not a pile of fat white lines. Without the
    // aerodrome polygon the runways and taxiways stripe over whatever landcover is underneath,
    // and grass shows between them. Protomaps leaves out the apron, so the pavement between the
    // gates and the taxiways doesn't draw.
    {
      layerName: 'roads',
      minZoom: 11,
      maxZoom: 12,
      lineTexts: [],
      lines: [
        {
          filters: [{
            match: 'string_in',
            key: 'kind_detail',
            value: [
              'runway',
            ],
          }],
          fill: 0xF8F8FAFF as RgbaU32,
          stroke: 0xCBD0DAFF as RgbaU32,
          radius: 1.5,
          pattern: 'solid',
          z: Z_OVERLAY_TRANSPORTATION,
        },
      ],
      points: [],
      polygons: [],
    },
    {
      layerName: 'landuse',
      minZoom: 11,
      maxZoom: 12,
      lineTexts: [],
      lines: [],
      points: [],
      polygons: [
        {
          filters: [{
            match: 'string_in',
            key: 'kind',
            value: [
              'aerodrome',
            ],
          }],
          fill: 0xE7E9EEFF as RgbaU32,
          stroke: 0 as RgbaU32,
          strokeRadius: 0,
          strokePattern: 'solid',
          z: Z_BASE_TERRAIN + 0.6,
        },
      ],
    },
    {
      layerName: 'roads',
      minZoom: 12,
      maxZoom: 13,
      lineTexts: [],
      lines: [
        {
          filters: [{
            match: 'string_in',
            key: 'kind_detail',
            value: [
              'runway',
            ],
          }],
          fill: 0xF8F8FAFF as RgbaU32,
          stroke: 0xCBD0DAFF as RgbaU32,
          radius: 3,
          pattern: 'solid',
          z: Z_OVERLAY_TRANSPORTATION,
        },
        {
          filters: [{
            match: 'string_in',
            key: 'kind_detail',
            value: [
              'taxiway',
            ],
          }],
          fill: 0xECEEF3FF as RgbaU32,
          stroke: 0xD3D8E2FF as RgbaU32,
          radius: 1.5,
          pattern: 'solid',
          z: Z_OVERLAY_TRANSPORTATION,
        },
      ],
      points: [],
      polygons: [],
    },
    {
      layerName: 'landuse',
      minZoom: 12,
      maxZoom: 13,
      lineTexts: [],
      lines: [],
      points: [],
      polygons: [
        {
          filters: [{
            match: 'string_in',
            key: 'kind',
            value: [
              'aerodrome',
            ],
          }],
          fill: 0xE7E9EEFF as RgbaU32,
          stroke: 0 as RgbaU32,
          strokeRadius: 0,
          strokePattern: 'solid',
          z: Z_BASE_TERRAIN + 0.6,
        },
      ],
    },
    {
      layerName: 'roads',
      minZoom: 13,
      maxZoom: 14,
      lineTexts: [],
      lines: [
        {
          filters: [{
            match: 'string_in',
            key: 'kind_detail',
            value: [
              'runway',
            ],
          }],
          fill: 0xF8F8FAFF as RgbaU32,
          stroke: 0xCBD0DAFF as RgbaU32,
          radius: 4,
          pattern: 'solid',
          z: Z_OVERLAY_TRANSPORTATION,
        },
        {
          filters: [{
            match: 'string_in',
            key: 'kind_detail',
            value: [
              'taxiway',
            ],
          }],
          fill: 0xECEEF3FF as RgbaU32,
          stroke: 0xD3D8E2FF as RgbaU32,
          radius: 2,
          pattern: 'solid',
          z: Z_OVERLAY_TRANSPORTATION,
        },
      ],
      points: [],
      polygons: [],
    },
    {
      layerName: 'landuse',
      minZoom: 13,
      maxZoom: 14,
      lineTexts: [],
      lines: [],
      points: [],
      polygons: [
        {
          filters: [{
            match: 'string_in',
            key: 'kind',
            value: [
              'aerodrome',
            ],
          }],
          fill: 0xE7E9EEFF as RgbaU32,
          stroke: 0 as RgbaU32,
          strokeRadius: 0,
          strokePattern: 'solid',
          z: Z_BASE_TERRAIN + 0.6,
        },
      ],
    },
    {
      layerName: 'roads',
      minZoom: 14,
      maxZoom: 15,
      lineTexts: [],
      lines: [
        {
          filters: [{
            match: 'string_in',
            key: 'kind_detail',
            value: [
              'runway',
            ],
          }],
          fill: 0xF8F8FAFF as RgbaU32,
          stroke: 0xCBD0DAFF as RgbaU32,
          radius: 6,
          pattern: 'solid',
          z: Z_OVERLAY_TRANSPORTATION,
        },
        {
          filters: [{
            match: 'string_in',
            key: 'kind_detail',
            value: [
              'taxiway',
            ],
          }],
          fill: 0xECEEF3FF as RgbaU32,
          stroke: 0xD3D8E2FF as RgbaU32,
          radius: 3,
          pattern: 'solid',
          z: Z_OVERLAY_TRANSPORTATION,
        },
      ],
      points: [],
      polygons: [],
    },
    {
      layerName: 'landuse',
      minZoom: 14,
      maxZoom: 15,
      lineTexts: [],
      lines: [],
      points: [],
      polygons: [
        {
          filters: [{
            match: 'string_in',
            key: 'kind',
            value: [
              'aerodrome',
            ],
          }],
          fill: 0xE7E9EEFF as RgbaU32,
          stroke: 0 as RgbaU32,
          strokeRadius: 0,
          strokePattern: 'solid',
          z: Z_BASE_TERRAIN + 0.6,
        },
      ],
    },
    {
      layerName: 'roads',
      minZoom: 15,
      maxZoom: 31,
      lineTexts: [],
      lines: [
        {
          filters: [{
            match: 'string_in',
            key: 'kind_detail',
            value: [
              'runway',
            ],
          }],
          fill: 0xF8F8FAFF as RgbaU32,
          stroke: 0xCBD0DAFF as RgbaU32,
          radius: 8,
          pattern: 'solid',
          z: Z_OVERLAY_TRANSPORTATION,
        },
        {
          filters: [{
            match: 'string_in',
            key: 'kind_detail',
            value: [
              'taxiway',
            ],
          }],
          fill: 0xECEEF3FF as RgbaU32,
          stroke: 0xD3D8E2FF as RgbaU32,
          radius: 4,
          pattern: 'solid',
          z: Z_OVERLAY_TRANSPORTATION,
        },
      ],
      points: [],
      polygons: [],
    },
    {
      layerName: 'landuse',
      minZoom: 15,
      maxZoom: 31,
      lineTexts: [],
      lines: [],
      points: [],
      polygons: [
        {
          filters: [{
            match: 'string_in',
            key: 'kind',
            value: [
              'aerodrome',
            ],
          }],
          fill: 0xE7E9EEFF as RgbaU32,
          stroke: 0 as RgbaU32,
          strokeRadius: 0,
          strokePattern: 'solid',
          z: Z_BASE_TERRAIN + 0.6,
        },
      ],
    },
    {
      layerName: 'boundaries',
      minZoom: 0,
      maxZoom: 3,
      lineTexts: [],
      lines: [
        {
          // Country borders: kind_detail is the admin_level, so 2 and any lower disputed or
          // supranational levels. Protomaps leaves out the offshore sovereignty line.
          filters: [{
            match: 'less_than',
            key: 'kind_detail',
            value: 3,
          }],
          fill: 0x55407099 as RgbaU32,
          stroke: 0x55407055 as RgbaU32,
          radius: 0.6,
          pattern: 'solid',
          z: Z_OVERLAY_TERRAIN + 0.9,
        },
      ],
      points: [],
      polygons: [],
    },
    {
      layerName: 'boundaries',
      minZoom: 3,
      maxZoom: 31,
      lineTexts: [],
      lines: [
        {
          // Country borders (repeated so they keep drawing at state-visible zooms).
          filters: [{
            match: 'less_than',
            key: 'kind_detail',
            value: 3,
          }],
          fill: 0x55407099 as RgbaU32,
          stroke: 0x55407055 as RgbaU32,
          radius: 0.6,
          pattern: 'solid',
          z: Z_OVERLAY_TERRAIN + 0.9,
        },
        {
          // State / province borders.
          filters: [{
            match: 'number_equals',
            key: 'kind_detail',
            value: 4,
          }],
          fill: 0x6a587ecc as RgbaU32,
          stroke: 0x6a587e77 as RgbaU32,
          radius: 0.55,
          pattern: 'solid',
          z: Z_OVERLAY_TERRAIN + 0.85,
        },
      ],
      points: [],
      polygons: [],
    },
    // Protomaps' landcover is the coarse cover derived from rasters, and the ground cover OSM maps
    // object by object is in landuse.
    {
      layerName: 'landcover',
      minZoom: 0,
      maxZoom: 31,
      lineTexts: [],
      lines: [],
      points: [],
      polygons: [
        {
          filters: [{
            match: 'string_in',
            key: 'kind',
            value: [
              'farmland',
              'grassland',
              'scrub',
            ],
          }],
          fill: 0x98D57A66 as RgbaU32,
          stroke: 0 as RgbaU32,
          strokeRadius: 0,
          strokePattern: 'solid',
          z: Z_BASE_TERRAIN + 0.2,
        },
        {
          filters: [{
            match: 'string_in',
            key: 'kind',
            value: [
              'forest',
            ],
          }],
          fill: 0x54AF2F66 as RgbaU32,
          stroke: 0 as RgbaU32,
          strokeRadius: 0,
          strokePattern: 'solid',
          z: Z_BASE_TERRAIN + 0.1,
        },
        {
          filters: [{
            match: 'string_in',
            key: 'kind',
            value: [
              'glacier',
            ],
          }],
          fill: ICE_FILL,
          stroke: 0 as RgbaU32,
          strokeRadius: 0,
          strokePattern: 'solid',
          z: Z_BASE_TERRAIN + 0.8,
        },
      ],
    },
    {
      layerName: 'landuse',
      minZoom: 0,
      maxZoom: 31,
      lineTexts: [],
      lines: [],
      points: [],
      polygons: [
        {
          filters: [{
            match: 'string_in',
            key: 'kind',
            value: [
              'wetland',
            ],
          }],
          fill: 0x63BE9366 as RgbaU32,
          stroke: 0 as RgbaU32,
          strokeRadius: 0,
          strokePattern: 'solid',
          z: Z_BASE_TERRAIN + 0.5,
        },
        {
          filters: [{
            match: 'string_in',
            key: 'kind',
            value: [
              'grass',
              'grassland',
              'meadow',
              'wood',
              'forest',
            ],
          }],
          fill: 0x72B94866 as RgbaU32,
          stroke: 0 as RgbaU32,
          strokeRadius: 0,
          strokePattern: 'solid',
          z: Z_BASE_TERRAIN + 0.5,
        },
        {
          filters: [{
            match: 'string_in',
            key: 'kind',
            value: [
              'sand',
              'beach',
            ],
          }],
          fill: 0xf5e1bccc as RgbaU32,
          stroke: 0 as RgbaU32,
          strokeRadius: 0,
          strokePattern: 'solid',
          z: Z_BASE_TERRAIN + 0.5,
        },
        {
          filters: [{
            match: 'string_in',
            key: 'kind',
            value: [
              'glacier',
            ],
          }],
          fill: ICE_FILL,
          stroke: 0 as RgbaU32,
          strokeRadius: 0,
          strokePattern: 'solid',
          z: Z_BASE_TERRAIN + 0.5,
        },
      ],
    },
    {
      layerName: 'pois',
      minZoom: 0,
      maxZoom: 10,
      lineTexts: [],
      lines: [],
      points: [PARK_LABEL],
      polygons: [],
    },
    {
      layerName: 'landuse',
      minZoom: 0,
      maxZoom: 10,
      lineTexts: [],
      lines: [],
      points: [],
      polygons: [
        {
          ...PARK_OUTLINE,
          fill: 0x8CC96A48 as RgbaU32,
          stroke: 0 as RgbaU32,
          strokeRadius: 0,
        },
      ],
    },
    {
      layerName: 'pois',
      minZoom: 10,
      maxZoom: 12,
      lineTexts: [],
      lines: [],
      // Protomaps ranks only the big regional parks and watersheds at 10.
      points: [rankedUnder(PARK_LABEL, 11)],
      polygons: [],
    },
    {
      layerName: 'landuse',
      minZoom: 10,
      maxZoom: 12,
      lineTexts: [],
      lines: [],
      points: [],
      // No outlines yet, because at this zoom a region's parks are dozens of parcels and their
      // outlines tangle into a mesh.
      polygons: [CITY_PARK_FILL],
    },
    {
      layerName: 'pois',
      minZoom: 12,
      maxZoom: 31,
      lineTexts: [],
      lines: [],
      points: [PARK_LABEL],
      polygons: [],
    },
    {
      layerName: 'landuse',
      minZoom: 12,
      maxZoom: 31,
      lineTexts: [],
      lines: [],
      points: [],
      polygons: [PARK_OUTLINE, CITY_PARK_FILL],
    },
    {
      layerName: 'places',
      minZoom: 0,
      maxZoom: 4,
      lineTexts: [],
      lines: [],
      points: [
        {
          filters: [{
            match: 'string_in',
            key: 'kind_detail',
            value: [
              'country',
            ],
          }, {
            match: 'less_than',
            key: 'min_zoom',
            value: 3,
          }],
          textFill: 0x000000FF as RgbaU32,
          textStroke: 0xEFEFEFFF as RgbaU32,
          textScale: 0.55,
          z: Z_OVERLAY_TEXT + 0.2,
        },
      ],
      polygons: [],
    },
    {
      layerName: 'places',
      minZoom: 4,
      maxZoom: 5,
      lineTexts: [],
      lines: [],
      points: [
        {
          filters: [{
            match: 'string_in',
            key: 'kind_detail',
            value: [
              'country',
            ],
          }, {
            match: 'less_than',
            key: 'min_zoom',
            value: 4,
          }],
          textFill: 0x000000FF as RgbaU32,
          textStroke: 0xEFEFEFFF as RgbaU32,
          textScale: 0.55,
          z: Z_OVERLAY_TEXT + 0.3,
        },
        {
          filters: [{
            match: 'string_in',
            key: 'kind_detail',
            value: [
              'province',
              'state',
            ],
          }, {
            match: 'less_than',
            key: 'min_zoom',
            value: 2,
          }],
          textFill: 0x000000FF as RgbaU32,
          textStroke: 0xEFEFEFFF as RgbaU32,
          textScale: 0.4,
          z: Z_OVERLAY_TEXT + 0.2,
        },
      ],
      polygons: [],
    },
    {
      layerName: 'places',
      minZoom: 5,
      maxZoom: 7,
      lineTexts: [],
      lines: [],
      points: [
        {
          filters: [{
            match: 'string_in',
            key: 'kind_detail',
            value: [
              'country',
            ],
          }, {
            match: 'less_than',
            key: 'min_zoom',
            value: 4,
          }],
          textFill: 0x000000FF as RgbaU32,
          textStroke: 0xEFEFEFFF as RgbaU32,
          textScale: 0.55,
          z: Z_OVERLAY_TEXT + 0.3,
        },
        {
          filters: [{
            match: 'string_in',
            key: 'kind_detail',
            value: [
              'province',
              'state',
            ],
          }, {
            match: 'less_than',
            key: 'min_zoom',
            value: 3,
          }],
          textFill: 0x000000FF as RgbaU32,
          textStroke: 0xEFEFEFFF as RgbaU32,
          textScale: 0.5,
          z: Z_OVERLAY_TEXT + 0.2,
        },
        {
          // Only the very top-tier cities at this zoom — capitals and a few peers.
          filters: [{
            match: 'string_in',
            key: 'kind_detail',
            value: [
              'city',
            ],
          }, {
            match: 'less_than',
            key: 'min_zoom',
            value: 3,
          }],
          textFill: 0x000000FF as RgbaU32,
          textStroke: 0xEFEFEFFF as RgbaU32,
          textScale: 0.45,
          z: Z_OVERLAY_TEXT + 0.1,
        },
      ],
      polygons: [],
    },
    {
      layerName: 'places',
      minZoom: 7,
      maxZoom: 10,
      lineTexts: [],
      lines: [],
      points: [
        {
          filters: [{
            match: 'string_in',
            key: 'kind_detail',
            value: [
              'city',
            ],
          }, {
            match: 'less_than',
            key: 'min_zoom',
            value: 8,
          }],
          textFill: 0x000000FF as RgbaU32,
          textStroke: 0xEFEFEFFF as RgbaU32,
          textScale: 0.5,
          z: Z_OVERLAY_TEXT + 0.1,
        },
        {
          filters: [{
            match: 'string_in',
            key: 'kind_detail',
            value: [
              'province',
              'state',
            ],
          }, {
            match: 'less_than',
            key: 'min_zoom',
            value: 4,
          }],
          textFill: 0x000000FF as RgbaU32,
          textStroke: 0xEFEFEFFF as RgbaU32,
          textScale: 0.55,
          z: Z_OVERLAY_TEXT + 0.11,
        },
      ],
      polygons: [],
    },
    {
      layerName: 'places',
      minZoom: 10,
      maxZoom: 11,
      lineTexts: [],
      lines: [],
      points: [
        MAJOR_CITY_LABEL,
        CITY_LABEL,
        rankedUnder(TOWN_LABEL, 11),
        rankedUnder(VILLAGE_LABEL, 11),
      ],
      polygons: [],
    },
    {
      layerName: 'places',
      minZoom: 11,
      maxZoom: 13,
      lineTexts: [],
      lines: [],
      points: [
        MAJOR_CITY_LABEL,
        CITY_LABEL,
        rankedUnder(TOWN_LABEL, 13),
        rankedUnder(VILLAGE_LABEL, 13),
        // Protomaps ranks the big parts of a city, like Noe Valley, at 11 and the rest at 13.
        rankedUnder(SUBURB_LABEL, 12),
      ],
      polygons: [],
    },
    {
      layerName: 'places',
      minZoom: 13,
      maxZoom: 31,
      lineTexts: [],
      lines: [],
      points: [
        MAJOR_CITY_LABEL,
        CITY_LABEL,
        TOWN_LABEL,
        VILLAGE_LABEL,
        SUBURB_LABEL,
        NEIGHBOURHOOD_LABEL,
      ],
      polygons: [],
    },
    // Roads are ribbons: a light warm grey fill inside a darker casing of the same hue, so the
    // hierarchy reads as width rather than as darkness. The casing is only the outer pixel of the
    // line (see line_program.ts#draw), so under about two pixels wide a road is all casing, and
    // the fills at the narrow end of the ramp are darkened toward the casing to compensate.
    //
    // Each class sits Z_OVERLAY_TRANSPORTATION + 0.15 above the one below it so a motorway's
    // casing covers the streets running into it. The step has to clear the 0.1 the line program
    // drops the casing by, or else a casing lands on top of the class above it.
    {
      layerName: 'roads',
      minZoom: 0,
      maxZoom: 9,
      lineTexts: [],
      lines: [
        {
          filters: [{
            match: 'string_in',
            key: 'kind_detail',
            value: [
              'primary',
              'primary_link',
            ],
          }],
          fill: 0x9B9180FF as RgbaU32,
          stroke: 0x9B9180FF as RgbaU32,
          radius: 0.5,
          pattern: 'solid',
          z: Z_OVERLAY_TRANSPORTATION + 0.75,
        },
        {
          filters: [{
            match: 'string_in',
            key: 'kind_detail',
            value: [
              'motorway',
              'motorway_link',
              'trunk',
              'trunk_link',
            ],
          }],
          fill: 0x8E8474FF as RgbaU32,
          stroke: 0x8E8474FF as RgbaU32,
          radius: 0.5,
          pattern: 'solid',
          z: Z_OVERLAY_TRANSPORTATION + 0.9,
        },
      ],
      points: [],
      polygons: [],
    },
    {
      layerName: 'roads',
      minZoom: 9,
      maxZoom: 11,
      lineTexts: [],
      lines: [
        {
          filters: [{
            match: 'string_in',
            key: 'kind_detail',
            value: [
              'secondary',
              'secondary_link',
            ],
          }],
          fill: 0xA49A88FF as RgbaU32,
          stroke: 0xA49A88FF as RgbaU32,
          radius: 0.5,
          pattern: 'solid',
          z: Z_OVERLAY_TRANSPORTATION + 0.6,
        },
        {
          filters: [{
            match: 'string_in',
            key: 'kind_detail',
            value: [
              'primary',
              'primary_link',
            ],
          }],
          fill: 0x9B9180FF as RgbaU32,
          stroke: 0x9B9180FF as RgbaU32,
          radius: 0.6,
          pattern: 'solid',
          z: Z_OVERLAY_TRANSPORTATION + 0.75,
        },
        {
          filters: [{
            match: 'string_in',
            key: 'kind_detail',
            value: [
              'motorway',
              'motorway_link',
              'trunk',
              'trunk_link',
            ],
          }],
          fill: 0xB3ACA1FF as RgbaU32,
          stroke: 0x8E8474FF as RgbaU32,
          radius: 0.8,
          pattern: 'solid',
          z: Z_OVERLAY_TRANSPORTATION + 0.9,
        },
      ],
      points: [],
      polygons: [],
    },
    {
      layerName: 'roads',
      minZoom: 11,
      maxZoom: 12,
      lineTexts: [],
      lines: [
        {
          filters: [{
            match: 'string_in',
            key: 'kind_detail',
            value: [
              'rail',
              'narrow_gauge',
              'preserved',
              'funicular',
              'subway',
              'light_rail',
              'tram',
              'monorail',
            ],
          }],
          fill: 0xAAAAAAAA as RgbaU32,
          stroke: 0xAAAAAAAA as RgbaU32,
          radius: 0.9,
          pattern: 'solid',
          z: Z_OVERLAY_TRANSPORTATION + 0.15,
        },
        {
          filters: [{
            match: 'string_in',
            key: 'kind_detail',
            value: [
              'residential',
              'unclassified',
              'living_street',
              'road',
            ],
          }],
          fill: 0xB2A998FF as RgbaU32,
          stroke: 0xB2A998FF as RgbaU32,
          radius: 0.5,
          pattern: 'solid',
          z: Z_OVERLAY_TRANSPORTATION + 0.3,
        },
        {
          filters: [{
            match: 'string_in',
            key: 'kind_detail',
            value: [
              'tertiary',
              'tertiary_link',
            ],
          }],
          fill: 0xD8D2C6FF as RgbaU32,
          stroke: 0xACA291FF as RgbaU32,
          radius: 0.75,
          pattern: 'solid',
          z: Z_OVERLAY_TRANSPORTATION + 0.45,
        },
        {
          filters: [{
            match: 'string_in',
            key: 'kind_detail',
            value: [
              'secondary',
              'secondary_link',
            ],
          }],
          fill: 0xE8E4DCFF as RgbaU32,
          stroke: 0xA49A88FF as RgbaU32,
          radius: 0.95,
          pattern: 'solid',
          z: Z_OVERLAY_TRANSPORTATION + 0.6,
        },
        {
          filters: [{
            match: 'string_in',
            key: 'kind_detail',
            value: [
              'primary',
              'primary_link',
            ],
          }],
          fill: 0xF5F3EFFF as RgbaU32,
          stroke: 0x9B9180FF as RgbaU32,
          radius: 1.15,
          pattern: 'solid',
          z: Z_OVERLAY_TRANSPORTATION + 0.75,
        },
        {
          filters: [{
            match: 'string_in',
            key: 'kind_detail',
            value: [
              'motorway',
              'motorway_link',
              'trunk',
              'trunk_link',
            ],
          }],
          fill: 0xFAF9F7FF as RgbaU32,
          stroke: 0x8E8474FF as RgbaU32,
          radius: 1.4,
          pattern: 'solid',
          z: Z_OVERLAY_TRANSPORTATION + 0.9,
        },
      ],
      points: [],
      polygons: [],
    },
    {
      layerName: 'roads',
      minZoom: 12,
      maxZoom: 13,
      lineTexts: [],
      lines: [
        {
          filters: [{
            match: 'string_in',
            key: 'kind_detail',
            value: [
              'rail',
              'narrow_gauge',
              'preserved',
              'funicular',
              'subway',
              'light_rail',
              'tram',
              'monorail',
            ],
          }],
          fill: 0xAAAAAAAA as RgbaU32,
          stroke: 0xAAAAAAAA as RgbaU32,
          radius: 1,
          pattern: 'solid',
          z: Z_OVERLAY_TRANSPORTATION + 0.15,
        },
        {
          filters: [{
            match: 'string_in',
            key: 'kind_detail',
            value: [
              'residential',
              'unclassified',
              'living_street',
              'road',
            ],
          }],
          fill: 0xFFFFFFFF as RgbaU32,
          stroke: 0xB2A998FF as RgbaU32,
          radius: 0.75,
          pattern: 'solid',
          z: Z_OVERLAY_TRANSPORTATION + 0.3,
        },
        {
          filters: [{
            match: 'string_in',
            key: 'kind_detail',
            value: [
              'tertiary',
              'tertiary_link',
            ],
          }],
          fill: 0xFFFFFFFF as RgbaU32,
          stroke: 0xB2A998FF as RgbaU32,
          radius: 1.15,
          pattern: 'solid',
          z: Z_OVERLAY_TRANSPORTATION + 0.45,
        },
        {
          filters: [{
            match: 'string_in',
            key: 'kind_detail',
            value: [
              'secondary',
              'secondary_link',
            ],
          }],
          fill: 0xFCFBF9FF as RgbaU32,
          stroke: 0xA49A88FF as RgbaU32,
          radius: 1.35,
          pattern: 'solid',
          z: Z_OVERLAY_TRANSPORTATION + 0.6,
        },
        {
          filters: [{
            match: 'string_in',
            key: 'kind_detail',
            value: [
              'primary',
              'primary_link',
            ],
          }],
          fill: 0xFFFFFFFF as RgbaU32,
          stroke: 0x9B9180FF as RgbaU32,
          radius: 1.7,
          pattern: 'solid',
          z: Z_OVERLAY_TRANSPORTATION + 0.75,
        },
        {
          filters: [{
            match: 'string_in',
            key: 'kind_detail',
            value: [
              'motorway',
              'motorway_link',
              'trunk',
              'trunk_link',
            ],
          }],
          fill: 0xFFFFFFFF as RgbaU32,
          stroke: 0x8E8474FF as RgbaU32,
          radius: 2.1,
          pattern: 'solid',
          z: Z_OVERLAY_TRANSPORTATION + 0.9,
        },
      ],
      points: [],
      polygons: [],
    },
    {
      layerName: 'roads',
      minZoom: 13,
      maxZoom: 15,
      lineTexts: [],
      lines: [
        {
          filters: [{
            match: 'string_in',
            key: 'kind_detail',
            value: [
              'service',
            ],
          }],
          fill: 0xDFDAD0FF as RgbaU32,
          stroke: 0xBCB4A5FF as RgbaU32,
          radius: 0.7,
          pattern: 'solid',
          z: Z_OVERLAY_TRANSPORTATION,
        },
        {
          filters: [{
            match: 'string_in',
            key: 'kind_detail',
            value: [
              'rail',
              'narrow_gauge',
              'preserved',
              'funicular',
              'subway',
              'light_rail',
              'tram',
              'monorail',
            ],
          }],
          fill: 0xAAAAAAAA as RgbaU32,
          stroke: 0xAAAAAAAA as RgbaU32,
          radius: 1,
          pattern: 'solid',
          z: Z_OVERLAY_TRANSPORTATION + 0.15,
        },
        {
          filters: [{
            match: 'string_in',
            key: 'kind_detail',
            value: [
              'residential',
              'unclassified',
              'living_street',
              'road',
            ],
          }],
          fill: 0xFFFFFFFF as RgbaU32,
          stroke: 0xB2A998FF as RgbaU32,
          radius: 1.5,
          pattern: 'solid',
          z: Z_OVERLAY_TRANSPORTATION + 0.3,
        },
        {
          filters: [{
            match: 'string_in',
            key: 'kind_detail',
            value: [
              'tertiary',
              'tertiary_link',
            ],
          }],
          fill: 0xF8F7F4FF as RgbaU32,
          stroke: 0xACA291FF as RgbaU32,
          radius: 1.5,
          pattern: 'solid',
          z: Z_OVERLAY_TRANSPORTATION + 0.45,
        },
        {
          filters: [{
            match: 'string_in',
            key: 'kind_detail',
            value: [
              'secondary',
              'secondary_link',
            ],
          }],
          fill: 0xFFFFFFFF as RgbaU32,
          stroke: 0xA49A88FF as RgbaU32,
          radius: 1.5,
          pattern: 'solid',
          z: Z_OVERLAY_TRANSPORTATION + 0.6,
        },
        {
          filters: [{
            match: 'string_in',
            key: 'kind_detail',
            value: [
              'primary',
              'primary_link',
            ],
          }],
          fill: 0xFFFFFFFF as RgbaU32,
          stroke: 0x9B9180FF as RgbaU32,
          radius: 1.9,
          pattern: 'solid',
          z: Z_OVERLAY_TRANSPORTATION + 0.75,
        },
        {
          filters: [{
            match: 'string_in',
            key: 'kind_detail',
            value: [
              'motorway',
              'motorway_link',
              'trunk',
              'trunk_link',
            ],
          }],
          fill: 0xFFFFFFFF as RgbaU32,
          stroke: 0x8E8474FF as RgbaU32,
          radius: 2.4,
          pattern: 'solid',
          z: Z_OVERLAY_TRANSPORTATION + 0.9,
        },
      ],
      points: [],
      polygons: [],
    },
    {
      // Protomaps stops at zoom 15, so past here we're overzooming and only the pixel widths grow.
      layerName: 'roads',
      minZoom: 15,
      maxZoom: 31,
      lineTexts: [],
      lines: [
        {
          filters: [{
            match: 'string_in',
            key: 'kind_detail',
            value: [
              'service',
            ],
          }],
          fill: 0xF6F5F2FF as RgbaU32,
          stroke: 0xBCB4A5FF as RgbaU32,
          radius: 1.5,
          pattern: 'solid',
          z: Z_OVERLAY_TRANSPORTATION,
        },
        {
          filters: [{
            match: 'string_in',
            key: 'kind_detail',
            value: [
              'rail',
              'narrow_gauge',
              'preserved',
              'funicular',
              'subway',
              'light_rail',
              'tram',
              'monorail',
            ],
          }],
          fill: 0xAAAAAAAA as RgbaU32,
          stroke: 0xAAAAAAAA as RgbaU32,
          radius: 1.2,
          pattern: 'solid',
          z: Z_OVERLAY_TRANSPORTATION + 0.15,
        },
        {
          filters: [{
            match: 'string_in',
            key: 'kind_detail',
            value: [
              'residential',
              'unclassified',
              'living_street',
              'road',
            ],
          }],
          fill: 0xFFFFFFFF as RgbaU32,
          stroke: 0xB2A998FF as RgbaU32,
          radius: 2.2,
          pattern: 'solid',
          z: Z_OVERLAY_TRANSPORTATION + 0.3,
        },
        {
          filters: [{
            match: 'string_in',
            key: 'kind_detail',
            value: [
              'tertiary',
              'tertiary_link',
            ],
          }],
          fill: 0xFFFFFFFF as RgbaU32,
          stroke: 0xACA291FF as RgbaU32,
          radius: 2.5,
          pattern: 'solid',
          z: Z_OVERLAY_TRANSPORTATION + 0.45,
        },
        {
          filters: [{
            match: 'string_in',
            key: 'kind_detail',
            value: [
              'secondary',
              'secondary_link',
            ],
          }],
          fill: 0xFFFFFFFF as RgbaU32,
          stroke: 0xA49A88FF as RgbaU32,
          radius: 3,
          pattern: 'solid',
          z: Z_OVERLAY_TRANSPORTATION + 0.6,
        },
        {
          filters: [{
            match: 'string_in',
            key: 'kind_detail',
            value: [
              'primary',
              'primary_link',
            ],
          }],
          fill: 0xFFFFFFFF as RgbaU32,
          stroke: 0x9B9180FF as RgbaU32,
          radius: 3.6,
          pattern: 'solid',
          z: Z_OVERLAY_TRANSPORTATION + 0.75,
        },
        {
          filters: [{
            match: 'string_in',
            key: 'kind_detail',
            value: [
              'motorway',
              'motorway_link',
              'trunk',
              'trunk_link',
            ],
          }],
          fill: 0xFFFFFFFF as RgbaU32,
          stroke: 0x8E8474FF as RgbaU32,
          radius: 4.5,
          pattern: 'solid',
          z: Z_OVERLAY_TRANSPORTATION + 0.9,
        },
      ],
      points: [],
      polygons: [],
    },
    // Road names, which this app doesn't care about except as landmarks for finding the trail
    // you're looking at. They sit just under Z_OVERLAY_TEXT so place and water names win the
    // collision (see recalculateCollisionZoom), and above every road so the halo covers the
    // ribbon.
    //
    // A motorway labels with its shield number instead of its name, because "101" orients you and
    // "Bayshore Freeway" doesn't. Protomaps only fills shield_text for a route that's actually
    // signed by number, so a road every local calls Central Expressway falls back to its name
    // rather than to a ref like "CR G6".
    {
      layerName: 'roads',
      minZoom: 10,
      maxZoom: 13,
      lineTexts: [
        {
          filters: [{
            match: 'string_in',
            key: 'kind_detail',
            value: [
              'motorway',
              'motorway_link',
              'trunk',
              'trunk_link',
            ],
          }],
          preferred: 'shield_text',
          fallback: 'name',
          fill: 0x655F57FF as RgbaU32,
          stroke: 0xFFFFFFDD as RgbaU32,
          scale: 0.5,
          z: Z_OVERLAY_TEXT - 0.05,
        },
      ],
      lines: [],
      points: [],
      polygons: [],
    },
    {
      layerName: 'roads',
      minZoom: 13,
      maxZoom: 16,
      lineTexts: [
        {
          filters: [{
            match: 'string_in',
            key: 'kind_detail',
            value: [
              'motorway',
              'motorway_link',
              'trunk',
              'trunk_link',
            ],
          }],
          preferred: 'shield_text',
          fallback: 'name',
          fill: 0x655F57FF as RgbaU32,
          stroke: 0xFFFFFFDD as RgbaU32,
          scale: 0.5,
          z: Z_OVERLAY_TEXT - 0.05,
        },
        {
          filters: [{
            match: 'string_in',
            key: 'kind_detail',
            value: [
              'primary',
              'primary_link',
              'secondary',
              'secondary_link',
              'tertiary',
              'tertiary_link',
            ],
          }],
          preferred: `name:${PREFERRED_LANGUAGE}`,
          fallback: 'name',
          fill: 0x736D64FF as RgbaU32,
          stroke: 0xFFFFFFDD as RgbaU32,
          scale: 0.48,
          z: Z_OVERLAY_TEXT - 0.06,
        },
      ],
      lines: [],
      points: [],
      polygons: [],
    },
    {
      layerName: 'roads',
      minZoom: 16,
      maxZoom: 31,
      lineTexts: [
        {
          filters: [{
            match: 'string_in',
            key: 'kind_detail',
            value: [
              'motorway',
              'motorway_link',
              'trunk',
              'trunk_link',
            ],
          }],
          preferred: 'shield_text',
          fallback: 'name',
          fill: 0x655F57FF as RgbaU32,
          stroke: 0xFFFFFFDD as RgbaU32,
          scale: 0.5,
          z: Z_OVERLAY_TEXT - 0.05,
        },
        {
          filters: [{
            match: 'string_in',
            key: 'kind_detail',
            value: [
              'primary',
              'primary_link',
              'secondary',
              'secondary_link',
              'tertiary',
              'tertiary_link',
            ],
          }],
          preferred: `name:${PREFERRED_LANGUAGE}`,
          fallback: 'name',
          fill: 0x736D64FF as RgbaU32,
          stroke: 0xFFFFFFDD as RgbaU32,
          scale: 0.48,
          z: Z_OVERLAY_TEXT - 0.06,
        },
        {
          filters: [{
            match: 'string_in',
            key: 'kind_detail',
            value: [
              'residential',
              'unclassified',
              'living_street',
              'road',
            ],
          }],
          preferred: `name:${PREFERRED_LANGUAGE}`,
          fallback: 'name',
          fill: 0x807A71FF as RgbaU32,
          stroke: 0xFFFFFFDD as RgbaU32,
          scale: 0.45,
          z: Z_OVERLAY_TEXT - 0.07,
        },
      ],
      lines: [],
      points: [],
      polygons: [],
    },
    {
      layerName: 'water',
      minZoom: 0,
      maxZoom: 31,
      lineTexts: [],
      lines: [],
      points: [],
      polygons: [
        {
          filters: [],
          fill: WATER_FILL,
          stroke: 0 as RgbaU32,
          strokeRadius: 0,
          strokePattern: 'solid',
          z: Z_BASE_WATER + 0.1, // put polygons above lines
        },
      ],
    },
    // Protomaps hangs a lake's name on the polygon rather than on a point, and the renderer only
    // labels points and lines, so this ends up labeling rivers and canals.
    {
      layerName: 'water',
      minZoom: 0,
      maxZoom: 31,
      lineTexts: [{
        filters: [],
        preferred: `name:${PREFERRED_LANGUAGE}`,
        fallback: 'name',
        fill: 0x1288E6FF as RgbaU32,
        stroke: 0xD0DCE5FF as RgbaU32,
        scale: 0.5,
        z: Z_OVERLAY_TEXT,
      }],
      lines: [],
      points: [
        {
          filters: [],
          textFill: 0x1288E6FF as RgbaU32,
          textStroke: 0xD0DCE5FF as RgbaU32,
          textScale: 0.5,
          z: Z_OVERLAY_TEXT,
        },
      ],
      polygons: [],
    },
    {
      layerName: 'water',
      minZoom: 0,
      maxZoom: 12,
      lineTexts: [],
      lines: [
        {
          filters: [{
            match: 'string_in',
            key: 'kind',
            value: [
              'canal',
              'river',
              'stream',
            ],
          }],
          fill: 0x7FC2E0FF as RgbaU32,
          stroke: 0x7FC2E0FF as RgbaU32,
          radius: 0.5,
          pattern: 'solid',
          z: Z_BASE_WATER,
        },
      ],
      points: [],
      polygons: [],
    },
    {
      layerName: 'water',
      minZoom: 12,
      maxZoom: 31,
      lineTexts: [{
        filters: [{
          match: 'string_in',
          key: 'kind',
          value: [
            'canal',
            'river',
            'stream',
          ],
        }],
        preferred: `name:${PREFERRED_LANGUAGE}`,
        fallback: 'name',
        fill: 0x1288E6FF as RgbaU32,
        stroke: 0xD0DCE5FF as RgbaU32,
        scale: 0.5,
        z: Z_OVERLAY_TEXT,
      }],
      lines: [
        {
          filters: [{
            match: 'string_in',
            key: 'kind',
            value: [
              'canal',
              'river',
              'stream',
            ],
          }],
          fill: 0x7FC2E0FF as RgbaU32,
          stroke: 0x7FC2E0FF as RgbaU32,
          radius: 0.5,
          pattern: 'solid',
          z: Z_BASE_WATER,
        },
      ],
      points: [],
      polygons: [],
    },
  ],
};

export class MbtileLayer extends Layer {

  private readonly fetcher: PoolClient<FetcherInitialize, FetcherRequest, FetcherCommand>;
  private fetching: boolean;
  private readonly labels: Map<string, IndexedLabel>;
  private readonly loader: PoolClient<LoaderInitialize, LoaderRequest, LoaderResponse>;
  private readonly loading: HashMap<TileId, Task<LoaderResponse>>;
  // Holds the raw MVT bytes for every currently-known tile so that when the
  // viewport's styleZoom bucket changes we can re-post each tile to the
  // loader at the new styleZoom without re-fetching over the network. This
  // is needed because tiles are fetched at `fetchZoom` (a cap-density-matched
  // value that can be much lower than viewport.zoom in spherical mode, per
  // commit 9af3745) while the layer-style detail should still track the
  // viewport so the rendered map looks like the user's actual zoom.
  private readonly rawBytes: HashMap<TileId, ArrayBuffer>;
  private readonly textBuffer: ArrayBuffer;
  private readonly textGlBuffer: WebGLBuffer;
  private readonly tiles: HashMap<TileId, LoadedTile>;
  private readonly placer: LabelPlacer;
  // The labels in placement order, or undefined when the set changed since the last sort
  private sorted: IndexedLabel[]|undefined;
  private styleZoom: number;
  private styleEpoch: number;

  constructor(
      copyrights: Copyright[],
      url: string,
      style: Style,
      private readonly extraZoom: number,
      minZoom: number,
      maxZoom: number,
      private readonly renderer: Renderer,
  ) {
    super(copyrights);
    this.fetcher =
        sharedPool<FetcherInitialize, FetcherRequest, FetcherCommand>(
            new URL('xyz_data_fetcher_worker.js', import.meta.url).href, /* count= */ 1)
            .connect({url, extraZoom, minZoom, maxZoom});
    this.fetching = false;
    this.labels = new Map();
    this.loader =
        sharedPool<LoaderInitialize, LoaderRequest, LoaderResponse>(
            new URL('mbtile_loader_worker.js', import.meta.url).href, loaderCount())
            .connect({style});
    this.loading = new HashMap(id => `${id.zoom},${id.x},${id.y}`);
    this.rawBytes = new HashMap(id => `${id.zoom},${id.x},${id.y}`);
    this.textBuffer = new ArrayBuffer(4194304);
    this.textGlBuffer = renderer.createDataBuffer(this.textBuffer.byteLength);
    this.tiles = new HashMap(id => `${id.zoom},${id.x},${id.y}`);
    this.registerDisposer(() => {
      this.fetcher.dispose();
      this.loader.dispose();
      this.renderer.deleteBuffer(this.textGlBuffer);

      for (const response of this.tiles.values()) {
        this.renderer.deleteBuffer(response.glGeometryBuffer);
        this.renderer.deleteBuffer(response.glIndexBuffer);
      }
    });
    this.placer = new LabelPlacer();
    this.sorted = undefined;
    // -1 is a sentinel: no styleZoom has been observed yet, so the first
    // viewportChanged adopts whatever the camera reports without triggering
    // a re-style pass (there are no cached raw bytes to re-style anyway).
    this.styleZoom = -1;
    this.styleEpoch = 0;

    this.fetcher.onresponse = command => {
      if (command.kind === 'ltc') {
        this.loadRawTile(command);
      } else if (command.kind === 'utc') {
        this.unloadTiles(command.ids);
      } else if (command.kind === 'usc') {
        this.fetching = command.fetching;
        this.redraw();
      } else {
        checkExhaustive(command);
      }
    };

    this.loader.onresponse = response => {
      if (response.kind === 'lr') {
        this.loadProcessedTile(response);
      } else {
        checkExhaustive(response.kind);
      }
    };

    // A tile whose load failed would otherwise count as loading forever
    this.loader.onfailure = (request, task) => {
      if (request.kind === 'lr' && this.loading.get(request.id) === task) {
        this.loading.delete(request.id);
        this.redraw();
        this.fetcher.broadcast({
          kind: 'tlr',
          id: request.id,
        });
      }
    };
  }

  /** Returns the properties of the queryable polygons at the point in the most detailed tile. */
  featuresAt(point: S2LatLng): Array<Record<string, ValueType>> {
    const [x, y] = projectS2LatLng(point);
    let best: {zoom: number; tile: LoadedTile}|undefined = undefined;
    for (const [id, tile] of this.tiles) {
      if (best && best.zoom >= id.zoom) {
        continue;
      }
      const tiles = 2 ** id.zoom;
      const tx = (x + 1) / 2 * tiles - id.x;
      const ty = (1 - y) / 2 * tiles - id.y;
      if (0 <= tx && tx < 1 && 0 <= ty && ty < 1) {
        best = {zoom: id.zoom, tile};
      }
    }
    return (best?.tile.queryable ?? [])
        .filter(f => containsPoint(f.geometry, f.starts, x, y))
        .map(f => f.properties);
  }

  /** Redraws every held tile with the style, without refetching. */
  setStyle(style: Style): void {
    this.styleEpoch += 1;
    this.loader.broadcast({
      kind: 'sr',
      style,
    });
    this.restyle();
  }

  override loadingData(): boolean {
    return this.fetching || this.loading.size > 0;
  }

  override render(planner: Planner, zoom: number, projection: ScreenProjection): void {
    // TODO(april): this results in bad behavior like low zoom tiles drawing over what should be
    // background at high zoom. We need to drop the depth buffer and just be careful about overdraw
    // with xyz tiles. Sad.
    //
    // Orrrr we could add a tile wide quad at the start of every tile...? But then we need the
    // stencil buffer not depth.
    const tiles = [...this.tiles].sort((a, b) => b[0].zoom - a[0].zoom);
    for (const [, response] of tiles) {
      planner.add(response.drawables);
    }

    if (!this.sorted) {
      this.sorted = [...this.labels.values()].sort(compareLabels);
    }
    const {byteSize, drawables} =
        this.placer.place(
            this.sorted, projection, zoom, this.textBuffer, this.textGlBuffer, this.renderer);
    planner.add(drawables);
    this.renderer.uploadData(this.textBuffer, byteSize, this.textGlBuffer);
  }

  override viewportChanged(
      bounds: S2LatLngRect, zoom: number, fetchZoom: number, cone?: SphericalCone): void {
    this.loader.start();
    const lat = bounds.lat();
    const lng = bounds.lng();
    this.fetcher.broadcast({
      kind: 'uvr',
      viewport: {
        lat: [lat.lo(), lat.hi()],
        lng: [lng.lo(), lng.hi()],
        zoom: fetchZoom,
        cone,
      },
    });

    // Floor of viewport zoom is a stable bucket: layerStyle.minZoom/maxZoom
    // boundaries are all integers, so styles only need to refresh when this
    // integer changes. Add extraZoom so layers calibrated against fetchZoom
    // (which includes extraZoom in the fetcher) match the original tuning.
    const newStyleZoom = Math.floor(zoom + this.extraZoom);
    if (newStyleZoom !== this.styleZoom) {
      this.styleZoom = newStyleZoom;
      this.restyle();
    }
  }

  private restyle(): void {
    for (const [id, data] of this.rawBytes) {
      this.load(id, data);
    }
  }

  private loadRawTile(command: LoadTileCommand): void {
    if (command.data.byteLength === 0) {
      this.fetcher.broadcast({
        kind: 'tlr',
        id: command.id,
      });
      return;
    }

    this.rawBytes.set(command.id, command.data);
    this.load(command.id, command.data);
  }

  private load(id: TileId, data: ArrayBuffer): void {
    // A request styled at an older zoom is only thrown away when it lands, so cancel it before a
    // worker spends time on it.
    this.loading.get(id)?.cancel();
    // No transfer list, so the worker gets a structured clone and this copy survives to restyle.
    this.loading.set(id, this.loader.post({
      kind: 'lr',
      id,
      styleZoom: this.styleZoom,
      styleEpoch: this.styleEpoch,
      data,
    }));
    this.redraw();
  }

  private loadProcessedTile(response: LoadResponse): void {
    // A new request for this tile at a different styleZoom or style has
    // already gone out; discard this stale styled output.
    if (response.styleZoom !== this.styleZoom || response.styleEpoch !== this.styleEpoch) {
      return;
    }

    for (const label of response.labels) {
      if (!GLYPHER.measurePx(label.graphemes, label.scale)) {
        // yolo!
        setTimeout(() => { this.loadProcessedTile(response); });
        return;
      }
    }

    this.disposeStyledTile(response.id);

    const geometry = this.renderer.createDataBuffer(response.geometry.byteLength);
    const index = this.renderer.createIndexBuffer(response.index.byteLength);
    this.renderer.uploadData(response.geometry, response.geometry.byteLength, geometry);
    this.renderer.uploadIndices(response.index, response.index.byteLength, index);
    const drawables = [];

    const labelKeys: string[] = [];
    const ownerKey = tileKey(response.id);
    for (const label of response.labels) {
      const key = labelKey(label);
      labelKeys.push(key);
      const existing = this.labels.get(key);
      if (existing) {
        existing.owners.add(ownerKey);
      } else {
        this.labels.set(key, {
          ...label,
          key,
          owners: new Set([ownerKey]),
          text: label.graphemes.join(''),
        });
      }
    }
    this.sorted = undefined;

    for (const line of response.lines) {
      drawables.push({
        elements: undefined,
        geometry,
        geometryByteLength: line.geometryByteLength,
        geometryOffset: line.geometryOffset,
        instanced: {
          count: line.instanceCount
        },
        program: this.renderer.lineProgram,
        texture: undefined,
        vertexCount: line.vertexCount,
        z: line.z,
      });
    }

    for (const polygon of response.polygons) {
      drawables.push({
        elements: {
          count: polygon.indexCount,
          index,
          offset: polygon.indexOffset,
        },
        geometry,
        geometryByteLength: polygon.geometryByteLength,
        geometryOffset: polygon.geometryOffset,
        instanced: undefined,
        program: this.renderer.triangleProgram,
        texture: undefined,
        vertexCount: undefined,
        z: polygon.z,
      });
    }

    this.loading.delete(response.id);
    this.tiles.set(response.id, {
      glGeometryBuffer: geometry,
      glIndexBuffer: index,
      drawables,
      labelKeys,
      queryable: response.queryable,
    });
    this.redraw();

    this.fetcher.broadcast({
      kind: 'tlr',
      id: response.id,
    });
  }

  private disposeStyledTile(id: TileId): void {
    const response = this.tiles.get(id);
    if (!response) {
      return;
    }
    this.tiles.delete(id);
    this.renderer.deleteBuffer(response.glGeometryBuffer);
    this.renderer.deleteBuffer(response.glIndexBuffer);

    const ownerKey = tileKey(id);
    for (const key of response.labelKeys) {
      const label = this.labels.get(key);
      if (!label) {
        continue;
      }
      label.owners.delete(ownerKey);
      if (label.owners.size === 0) {
        this.labels.delete(key);
      }
    }
    this.sorted = undefined;
  }

  private unloadTiles(ids: TileId[]): void {
    for (const id of ids) {
      const task = this.loading.get(id);
      if (task) {
        this.loading.delete(id);
        task.cancel();
      }

      this.rawBytes.delete(id);
      this.disposeStyledTile(id);
    }
    this.redraw();
  }
}

// Counts crossings across every ring, so holes and the parts of a multipolygon need no special
// casing.
function containsPoint(geometry: number[], starts: number[], x: number, y: number): boolean {
  let inside = false;
  for (let r = 0; r < starts.length; ++r) {
    const begin = starts[r];
    const end = r < starts.length - 1 ? starts[r + 1] : geometry.length;
    for (let i = begin, j = end - 2; i < end; j = i, i += 2) {
      const xi = geometry[i];
      const yi = geometry[i + 1];
      const xj = geometry[j];
      const yj = geometry[j + 1];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
  }
  return inside;
}
