import { S2LatLngRect } from 'java/org/trailcatalog/s2';
import * as arrays from 'external/dev_april_corgi+/js/common/arrays';
import { checkExhaustive, checkExists } from 'external/dev_april_corgi+/js/common/asserts';
import { HashMap, HashSet } from 'external/dev_april_corgi+/js/common/collections';
import { QueuedWorkerPool, Task } from 'external/dev_april_corgi+/js/common/queued_worker_pool';
import { WorkerPool } from 'external/dev_april_corgi+/js/common/worker_pool';
import { getLanguage } from 'external/dev_april_corgi+/js/server/ssr_aware';

import { SphericalCone } from '../camera';
import { WorldBoundsQuadtree } from '../common/bounds_quadtree';
import { Copyright, Rect, RgbaU32, TileId, Vec2 } from '../common/types';
import { Layer } from '../layer';
import { GLYPHER } from '../rendering/glypher';
import { Planner } from '../rendering/planner';
import { Drawable } from '../rendering/program';
import { Renderer } from '../rendering/renderer';
import { Label, LoadResponse, Request as LoaderRequest, Response as LoaderResponse, Style } from '../workers/mbtile_loader';
import { Command as FetcherCommand, LoadTileCommand, Request as FetcherRequest, UnloadTilesCommand } from '../workers/xyz_data_fetcher';
import { Z_BASE_TERRAIN, Z_BASE_WATER, Z_OVERLAY_TERRAIN, Z_OVERLAY_TEXT, Z_OVERLAY_TRANSPORTATION } from '../z';

interface LoadedTile {
  drawables: Drawable[];
  glGeometryBuffer: WebGLBuffer;
  glIndexBuffer: WebGLBuffer;
  labelKeys: string[];
}

interface IndexedLabel extends Label {
  id: number;
  key: string;
  owners: Set<string>;
  bound: Rect;
  collidedMinZoom: number;
  radius: Vec2;
}

function tileKey(id: TileId): string {
  return `${id.zoom},${id.x},${id.y}`;
}

// Extra pixel padding applied between labels in collision math. SAME_TEXT_PAD_PX is the larger
// gap enforced between labels with identical text. DIFFERENT_TEXT_PAD_PX is the breathing room
// between any pair, so visually-close labels (e.g., a tilted river or lake name next to a
// horizontal state name) get one suppressed even when their tight AABBs don't quite intersect.
// The label bound is sized to SAME_TEXT_PAD_PX (the larger value) so queryRect finds the
// candidates for both cases.
const SAME_TEXT_PAD_PX = 384;
const DIFFERENT_TEXT_PAD_PX = 32;

function labelBound(center: Vec2, w: number, h: number, minZoom: number): Rect {
  const mzWorldSize = 256 * Math.pow(2, minZoom);
  const hwWorld = w / mzWorldSize;
  const hhWorld = h / mzWorldSize;
  return {
    low: [center[0] - hwWorld, center[1] - hhWorld] as const,
    high: [center[0] + hwWorld, center[1] + hhWorld] as const,
  };
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

// TODO(april): we should glaciate the contours if it looks good
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
          stipple: false,
          z: Z_OVERLAY_TERRAIN,
        },
        {
          filters: [{
            match: 'greater_than',
            key: 'nth_line',
            value: 2,
          }],
          fill: 0x00000040 as RgbaU32,
          stroke: 0x00000040 as RgbaU32,
          radius: 0.5,
          stipple: false,
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
      lineTexts: [],
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
          fill: 0x048AB960 as RgbaU32,
          stroke: 0x048AB960 as RgbaU32,
          radius: 0.5,
          stipple: false,
          z: Z_OVERLAY_TERRAIN,
        },
        {
          filters: [{
            match: 'greater_than',
            key: 'nth_line',
            value: 5,
          }],
          fill: 0x00000040 as RgbaU32,
          stroke: 0x00000040 as RgbaU32,
          radius: 0.5,
          stipple: false,
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
      lineTexts: [],
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
          fill: 0x048AB960 as RgbaU32,
          stroke: 0x048AB960 as RgbaU32,
          radius: 0.75,
          stipple: false,
          z: Z_OVERLAY_TERRAIN,
        },
        {
          filters: [{
            match: 'greater_than',
            key: 'nth_line',
            value: 5,
          }],
          fill: 0x00000040 as RgbaU32,
          stroke: 0x00000040 as RgbaU32,
          radius: 0.75,
          stipple: false,
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
          stipple: false,
          z: Z_OVERLAY_TERRAIN,
        },
        {
          filters: [],
          fill: 0x00000040 as RgbaU32,
          stroke: 0x00000040 as RgbaU32,
          radius: 0.5,
          stipple: false,
          z: Z_OVERLAY_TERRAIN,
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
          stipple: false,
          z: Z_OVERLAY_TERRAIN,
        },
        {
          filters: [{
            match: 'greater_than',
            key: 'nth_line',
            value: 2,
          }],
          fill: 0x00000040 as RgbaU32,
          stroke: 0x00000040 as RgbaU32,
          radius: 0.5,
          stipple: false,
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
      lineTexts: [],
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
          fill: 0x048AB960 as RgbaU32,
          stroke: 0x048AB960 as RgbaU32,
          radius: 0.75,
          stipple: false,
          z: Z_OVERLAY_TERRAIN,
        },
        {
          filters: [{
            match: 'greater_than',
            key: 'nth_line',
            value: 5,
          }],
          fill: 0x00000040 as RgbaU32,
          stroke: 0x00000040 as RgbaU32,
          radius: 0.75,
          stipple: false,
          z: Z_OVERLAY_TERRAIN,
        },
        {
          filters: [{
            match: 'greater_than',
            key: 'nth_line',
            value: 1,
          }, {
            match: 'number_equals',
            key: 'glacier',
            value: 1,
          }],
          fill: 0x048AB960 as RgbaU32,
          stroke: 0x048AB960 as RgbaU32,
          radius: 0.5,
          stipple: false,
          z: Z_OVERLAY_TERRAIN,
        },
        {
          filters: [{
            match: 'greater_than',
            key: 'nth_line',
            value: 1,
          }],
          fill: 0x00000040 as RgbaU32,
          stroke: 0x00000040 as RgbaU32,
          radius: 0.5,
          stipple: false,
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
      lineTexts: [],
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
          fill: 0x048AB960 as RgbaU32,
          stroke: 0x048AB960 as RgbaU32,
          radius: 0.75,
          stipple: false,
          z: Z_OVERLAY_TERRAIN,
        },
        {
          filters: [{
            match: 'greater_than',
            key: 'nth_line',
            value: 5,
          }],
          fill: 0x00000040 as RgbaU32,
          stroke: 0x00000040 as RgbaU32,
          radius: 0.75,
          stipple: false,
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
          stipple: false,
          z: Z_OVERLAY_TERRAIN,
        },
        {
          filters: [],
          fill: 0x00000040 as RgbaU32,
          stroke: 0x00000040 as RgbaU32,
          radius: 0.5,
          stipple: false,
          z: Z_OVERLAY_TERRAIN,
        },
      ],
      points: [],
      polygons: [],
    },
  ],
};

export const NATURE: Readonly<Style> = {
  layers: [
    {
      layerName: 'aeroway',
      minZoom: 11,
      maxZoom: 12,
      lineTexts: [],
      lines: [
        {
          filters: [{
            match: 'string_in',
            key: 'class',
            value: [
              'runway',
            ],
          }],
          fill: 0xFFFFFFFF as RgbaU32,
          stroke: 0xFFFFFFFF as RgbaU32,
          radius: 1.5,
          stipple: false,
          z: Z_OVERLAY_TRANSPORTATION,
        },
      ],
      points: [],
      polygons: [],
    },
    {
      layerName: 'aeroway',
      minZoom: 12,
      maxZoom: 13,
      lineTexts: [],
      lines: [
        {
          filters: [{
            match: 'string_in',
            key: 'class',
            value: [
              'runway',
            ],
          }],
          fill: 0xFFFFFFFF as RgbaU32,
          stroke: 0xFFFFFFFF as RgbaU32,
          radius: 3,
          stipple: false,
          z: Z_OVERLAY_TRANSPORTATION,
        },
        {
          filters: [{
            match: 'string_in',
            key: 'class',
            value: [
              'taxiway',
            ],
          }],
          fill: 0xFFFFFFFF as RgbaU32,
          stroke: 0xFFFFFFFF as RgbaU32,
          radius: 1.5,
          stipple: false,
          z: Z_OVERLAY_TRANSPORTATION,
        },
      ],
      points: [],
      polygons: [],
    },
    {
      layerName: 'aeroway',
      minZoom: 13,
      maxZoom: 14,
      lineTexts: [],
      lines: [
        {
          filters: [{
            match: 'string_in',
            key: 'class',
            value: [
              'runway',
            ],
          }],
          fill: 0xFFFFFFFF as RgbaU32,
          stroke: 0xFFFFFFFF as RgbaU32,
          radius: 4,
          stipple: false,
          z: Z_OVERLAY_TRANSPORTATION,
        },
        {
          filters: [{
            match: 'string_in',
            key: 'class',
            value: [
              'taxiway',
            ],
          }],
          fill: 0xFFFFFFFF as RgbaU32,
          stroke: 0xFFFFFFFF as RgbaU32,
          radius: 2,
          stipple: false,
          z: Z_OVERLAY_TRANSPORTATION,
        },
      ],
      points: [],
      polygons: [],
    },
    {
      layerName: 'aeroway',
      minZoom: 14,
      maxZoom: 15,
      lineTexts: [],
      lines: [
        {
          filters: [{
            match: 'string_in',
            key: 'class',
            value: [
              'runway',
            ],
          }],
          fill: 0xFFFFFFFF as RgbaU32,
          stroke: 0xFFFFFFFF as RgbaU32,
          radius: 6,
          stipple: false,
          z: Z_OVERLAY_TRANSPORTATION,
        },
        {
          filters: [{
            match: 'string_in',
            key: 'class',
            value: [
              'taxiway',
            ],
          }],
          fill: 0xFFFFFFFF as RgbaU32,
          stroke: 0xFFFFFFFF as RgbaU32,
          radius: 3,
          stipple: false,
          z: Z_OVERLAY_TRANSPORTATION,
        },
      ],
      points: [],
      polygons: [],
    },
    {
      layerName: 'aeroway',
      minZoom: 15,
      maxZoom: 31,
      lineTexts: [],
      lines: [
        {
          filters: [{
            match: 'string_in',
            key: 'class',
            value: [
              'runway',
            ],
          }],
          fill: 0xFFFFFFFF as RgbaU32,
          stroke: 0xFFFFFFFF as RgbaU32,
          radius: 8,
          stipple: false,
          z: Z_OVERLAY_TRANSPORTATION,
        },
        {
          filters: [{
            match: 'string_in',
            key: 'class',
            value: [
              'taxiway',
            ],
          }],
          fill: 0xFFFFFFFF as RgbaU32,
          stroke: 0xFFFFFFFF as RgbaU32,
          radius: 4,
          stipple: false,
          z: Z_OVERLAY_TRANSPORTATION,
        },
      ],
      points: [],
      polygons: [],
    },
    {
      layerName: 'boundary',
      minZoom: 0,
      maxZoom: 3,
      lineTexts: [],
      lines: [
        {
          // Country borders: admin_level 2 (and any lower disputed/supranational levels).
          filters: [{
            match: 'less_than',
            key: 'admin_level',
            value: 3,
          }],
          fill: 0x55407099 as RgbaU32,
          stroke: 0x55407055 as RgbaU32,
          radius: 0.6,
          stipple: false,
          z: Z_OVERLAY_TERRAIN + 0.9,
        },
      ],
      points: [],
      polygons: [],
    },
    {
      layerName: 'boundary',
      minZoom: 3,
      maxZoom: 31,
      lineTexts: [],
      lines: [
        {
          // Country borders (repeated so they keep drawing at state-visible zooms).
          filters: [{
            match: 'less_than',
            key: 'admin_level',
            value: 3,
          }],
          fill: 0x55407099 as RgbaU32,
          stroke: 0x55407055 as RgbaU32,
          radius: 0.6,
          stipple: false,
          z: Z_OVERLAY_TERRAIN + 0.9,
        },
        {
          // State / province borders.
          filters: [{
            match: 'number_equals',
            key: 'admin_level',
            value: 4,
          }],
          fill: 0x6a587ecc as RgbaU32,
          stroke: 0x6a587e77 as RgbaU32,
          radius: 0.55,
          stipple: false,
          z: Z_OVERLAY_TERRAIN + 0.85,
        },
      ],
      points: [],
      polygons: [],
    },
    {
      layerName: 'contour_ft',
      minZoom: 0,
      maxZoom: 31,
      lineTexts: [],
      lines: [
        {
          filters: [{
            match: 'greater_than',
            key: 'nth_line',
            value: 2,
          }],
          fill: 0x00000040 as RgbaU32,
          stroke: 0x00000040 as RgbaU32,
          radius: 0.5,
          stipple: false,
          z: Z_OVERLAY_TERRAIN,
        },
      ],
      points: [],
      polygons: [],
    },
    {
      layerName: 'globallandcover',
      minZoom: 0,
      maxZoom: 31,
      lineTexts: [],
      lines: [],
      points: [],
      polygons: [
        {
          filters: [{
            match: 'string_in',
            key: 'class',
            value: [
              'crop',
              'grass',
              'scrub',
            ],
          }],
          fill: 0x6fd1954C as RgbaU32,
          stroke: 0 as RgbaU32,
          strokeRadius: 0,
          strokeStipple: false,
          z: Z_BASE_TERRAIN + 0.2,
        },
        {
          filters: [{
            match: 'string_in',
            key: 'class',
            value: [
              'forest',
              'tree',
            ],
          }],
          fill: 0x21ad574C as RgbaU32,
          stroke: 0 as RgbaU32,
          strokeRadius: 0,
          strokeStipple: false,
          z: Z_BASE_TERRAIN + 0.1,
        },
        {
          filters: [{
            match: 'string_in',
            key: 'class',
            value: [
              'snow',
            ],
          }],
          fill: 0xFFFFFFF80 as RgbaU32,
          stroke: 0 as RgbaU32,
          strokeRadius: 0,
          strokeStipple: false,
          z: Z_BASE_TERRAIN + 0.8,
        },
      ],
    },
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
            key: 'class',
            value: [
              'wetland',
            ],
          }],
          fill: 0x6fd1954C as RgbaU32,
          stroke: 0 as RgbaU32,
          strokeRadius: 0,
          strokeStipple: false,
          z: Z_BASE_TERRAIN + 0.5,
        },
        {
          filters: [{
            match: 'string_in',
            key: 'class',
            value: [
              'grass',
              'wood',
            ],
          }],
          fill: 0x51C5874C as RgbaU32,
          stroke: 0 as RgbaU32,
          strokeRadius: 0,
          strokeStipple: false,
          z: Z_BASE_TERRAIN + 0.5,
        },
        {
          filters: [{
            match: 'string_in',
            key: 'class',
            value: [
              'sand',
              'state_beach',
            ],
          }],
          fill: 0xf5e1bccc as RgbaU32,
          stroke: 0 as RgbaU32,
          strokeRadius: 0,
          strokeStipple: false,
          z: Z_BASE_TERRAIN + 0.5,
        },
        {
          filters: [{
            match: 'string_in',
            key: 'class',
            value: [
              'ice',
            ],
          }],
          fill: 0xFFFFFFF80 as RgbaU32,
          stroke: 0 as RgbaU32,
          strokeRadius: 0,
          strokeStipple: false,
          z: Z_BASE_TERRAIN + 0.5,
        },
      ],
    },
    {
      layerName: 'park',
      minZoom: 0,
      maxZoom: 10,
      lineTexts: [],
      lines: [],
      points: [
        {
          filters: [
            {
              match: 'string_in',
              key: 'class',
              value: [
                'national_park',
                'wilderness_area',
              ],
            },
          ],
          textFill: 0x007D25FF as RgbaU32,
          textStroke: 0xEFEFEFFF as RgbaU32,
          textScale: 0.4,
          z: Z_OVERLAY_TEXT + 0.1,
        },
      ],
      polygons: [
        {
          filters: [{
            match: 'string_in',
            key: 'class',
            value: [
              //'city_park',
              //'county_park',
              // TODO(april): this looks gross at the nortern tip of Greenland
              'national_park',
              'wilderness_area',
              //'nature_reserve',
              //'open_space_preserve',
              //'regional_park',
              //'state_park',
              //'state_wilderness',
            ],
          }],
          fill: 0x21ad5780 as RgbaU32,
          stroke: 0 as RgbaU32,
          strokeRadius: 0,
          strokeStipple: false,
          z: Z_BASE_TERRAIN + 0.75,
        },
      ],
    },
    {
      layerName: 'park',
      minZoom: 10,
      maxZoom: 31,
      lineTexts: [],
      lines: [],
      points: [
        {
          filters: [
            {
              match: 'string_in',
              key: 'class',
              value: [
                'national_park',
                'wilderness_area',
              ],
            },
          ],
          textFill: 0x007D25FF as RgbaU32,
          textStroke: 0xEFEFEFFF as RgbaU32,
          textScale: 0.45,
          z: Z_OVERLAY_TEXT + 0.1,
        },
      ],
      polygons: [
        {
          filters: [{
            match: 'string_in',
            key: 'class',
            value: [
              //'city_park',
              //'county_park',
              // TODO(april): this looks gross at the nortern tip of Greenland
              'national_park',
              'wilderness_area',
              //'nature_reserve',
              //'open_space_preserve',
              //'regional_park',
              //'state_park',
              //'state_wilderness',
            ],
          }],
          fill: 0 as RgbaU32,
          stroke: 0x13653288 as RgbaU32,
          strokeRadius: 1,
          strokeStipple: false,
          z: Z_BASE_TERRAIN + 0.75,
        },
      ],
    },
    {
      layerName: 'place',
      minZoom: 0,
      maxZoom: 4,
      lineTexts: [],
      lines: [],
      points: [
        {
          filters: [
            {
              match: 'string_in',
              key: 'class',
              value: [
                'country',
              ],
            },
            {
              match: 'less_than',
              key: 'rank',
              value: 3,
            },
          ],
          textFill: 0x000000FF as RgbaU32,
          textStroke: 0xEFEFEFFF as RgbaU32,
          textScale: 0.5,
          z: Z_OVERLAY_TEXT + 0.2,
        },
      ],
      polygons: [],
    },
    {
      layerName: 'place',
      minZoom: 4,
      maxZoom: 5,
      lineTexts: [],
      lines: [],
      points: [
        {
          filters: [
            {
              match: 'string_in',
              key: 'class',
              value: [
                'country',
              ],
            },
            {
              match: 'less_than',
              key: 'rank',
              value: 4,
            },
          ],
          textFill: 0x000000FF as RgbaU32,
          textStroke: 0xEFEFEFFF as RgbaU32,
          textScale: 0.5,
          z: Z_OVERLAY_TEXT + 0.3,
        },
        {
          filters: [
            {
              match: 'string_in',
              key: 'class',
              value: [
                'province',
                'state',
              ],
            },
            {
              match: 'less_than',
              key: 'rank',
              value: 2,
            },
          ],
          textFill: 0x000000FF as RgbaU32,
          textStroke: 0xEFEFEFFF as RgbaU32,
          textScale: 0.45,
          z: Z_OVERLAY_TEXT + 0.2,
        },
      ],
      polygons: [],
    },
    {
      layerName: 'place',
      minZoom: 5,
      maxZoom: 7,
      lineTexts: [],
      lines: [],
      points: [
        {
          filters: [
            {
              match: 'string_in',
              key: 'class',
              value: [
                'country',
              ],
            },
            {
              match: 'less_than',
              key: 'rank',
              value: 4,
            },
          ],
          textFill: 0x000000FF as RgbaU32,
          textStroke: 0xEFEFEFFF as RgbaU32,
          textScale: 0.5,
          z: Z_OVERLAY_TEXT + 0.3,
        },
        {
          filters: [
            {
              match: 'string_in',
              key: 'class',
              value: [
                'province',
                'state',
              ],
            },
            {
              match: 'less_than',
              key: 'rank',
              value: 3,
            },
          ],
          textFill: 0x000000FF as RgbaU32,
          textStroke: 0xEFEFEFFF as RgbaU32,
          textScale: 0.45,
          z: Z_OVERLAY_TEXT + 0.2,
        },
      ],
      polygons: [],
    },
    {
      layerName: 'place',
      minZoom: 7,
      maxZoom: 10,
      lineTexts: [],
      lines: [],
      points: [
        {
          filters: [{
            match: 'string_in',
            key: 'class',
            value: [
              'city',
            ],
          }],
          textFill: 0x000000FF as RgbaU32,
          textStroke: 0xEFEFEFFF as RgbaU32,
          textScale: 0.4,
          z: Z_OVERLAY_TEXT + 0.1,
        },
        {
          filters: [{
            match: 'string_in',
            key: 'class',
            value: [
              'province',
              'state',
            ],
          }],
          textFill: 0x000000FF as RgbaU32,
          textStroke: 0xEFEFEFFF as RgbaU32,
          textScale: 0.6,
          z: Z_OVERLAY_TEXT + 0.11,
        },
      ],
      polygons: [],
    },
    {
      layerName: 'place',
      minZoom: 10,
      maxZoom: 31,
      lineTexts: [],
      lines: [],
      points: [
        {
          filters: [{
            match: 'string_in',
            key: 'class',
            value: [
              'city',
              'town',
            ],
          }],
          textFill: 0x000000FF as RgbaU32,
          textStroke: 0xEFEFEFFF as RgbaU32,
          textScale: 0.4,
          z: Z_OVERLAY_TEXT + 0.11,
        },
      ],
      polygons: [],
    },
    {
      layerName: 'transportation',
      minZoom: 0,
      maxZoom: 11,
      lineTexts: [],
      lines: [
        {
          filters: [{
            match: 'string_in',
            key: 'class',
            value: [
              'primary',
              'primary_construction',
              'secondary',
              'secondary_construction',
            ],
          }],
          fill: 0xFFFFFFFF as RgbaU32,
          stroke: 0xFFFFFFFF as RgbaU32,
          radius: 0.75,
          stipple: false,
          z: Z_OVERLAY_TRANSPORTATION,
        },
        {
          filters: [{
            match: 'string_in',
            key: 'class',
            value: [
              'motorway',
              'motorway_construction',
              'trunk',
            ],
          }],
          fill: 0xFFFFFFFF as RgbaU32,
          stroke: 0xFFFFFFFF as RgbaU32,
          radius: 0.75,
          stipple: false,
          z: Z_OVERLAY_TRANSPORTATION,
        },
      ],
      points: [],
      polygons: [],
    },
    {
      layerName: 'transportation',
      minZoom: 11,
      maxZoom: 31,
      lineTexts: [],
      lines: [
        {
          filters: [{
            match: 'string_in',
            key: 'class',
            value: [
              'rail',
              'transit',
            ],
          }],
          fill: 0xAAAAAAAA as RgbaU32,
          stroke: 0xAAAAAAAA as RgbaU32,
          radius: 1,
          stipple: false,
          z: Z_OVERLAY_TRANSPORTATION,
        },
        {
          filters: [{
            match: 'string_in',
            key: 'class',
            value: [
              'minor',
              'minor_construction',
              'service',
              'tertiary',
            ],
          }],
          fill: 0xFFFFFFFF as RgbaU32,
          stroke: 0xFFFFFFFF as RgbaU32,
          radius: 0.75,
          stipple: false,
          z: Z_OVERLAY_TRANSPORTATION,
        },
        {
          filters: [{
            match: 'string_in',
            key: 'class',
            value: [
              'primary',
              'primary_construction',
              'secondary',
              'secondary_construction',
            ],
          }],
          fill: 0xFFFFFFFF as RgbaU32,
          stroke: 0xFFFFFFFF as RgbaU32,
          radius: 1.5,
          stipple: false,
          z: Z_OVERLAY_TRANSPORTATION,
        },
        {
          filters: [{
            match: 'string_in',
            key: 'class',
            value: [
              'motorway',
              'motorway_construction',
              'trunk',
            ],
          }],
          fill: 0xFFFFFFFF as RgbaU32,
          stroke: 0xFFFFFFFF as RgbaU32,
          radius: 1.5,
          stipple: false,
          z: Z_OVERLAY_TRANSPORTATION,
        },
      ],
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
          fill: 0x52BAEBFF as RgbaU32,
          stroke: 0 as RgbaU32,
          strokeRadius: 0,
          strokeStipple: false,
          z: Z_BASE_WATER + 0.1, // put polygons above lines
        },
      ],
    },
    {
      layerName: 'water_name',
      minZoom: 0,
      maxZoom: 31,
      lineTexts: [{
        filters: [],
        preferred: `name:${PREFERRED_LANGUAGE}`,
        fallback: 'name',
        fill: 0x1288E6FF as RgbaU32,
        stroke: 0xD0DCE5FF as RgbaU32,
        scale: 0.4,
        z: Z_OVERLAY_TEXT,
      }],
      lines: [],
      points: [],
      polygons: [],
    },
    {
      layerName: 'waterway',
      minZoom: 0,
      maxZoom: 12,
      lineTexts: [],
      lines: [
        {
          filters: [{
            match: 'string_in',
            key: 'class',
            value: [
              'canal',
              'river',
              'stream',
            ],
          }],
          fill: 0x52BAEBFF as RgbaU32,
          stroke: 0x52BAEBFF as RgbaU32,
          radius: 0.5,
          stipple: false,
          z: Z_BASE_WATER,
        },
      ],
      points: [],
      polygons: [],
    },
    {
      layerName: 'waterway',
      minZoom: 12,
      maxZoom: 31,
      lineTexts: [{
        filters: [{
          match: 'string_in',
          key: 'class',
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
        scale: 0.4,
        z: Z_OVERLAY_TEXT,
      }],
      lines: [
        {
          filters: [{
            match: 'string_in',
            key: 'class',
            value: [
              'canal',
              'river',
              'stream',
            ],
          }],
          fill: 0x52BAEBFF as RgbaU32,
          stroke: 0x52BAEBFF as RgbaU32,
          radius: 0.5,
          stipple: false,
          z: Z_BASE_WATER,
        },
      ],
      points: [],
      polygons: [],
    },
  ],
};

export class MbtileLayer extends Layer {

  private readonly fetcher: WorkerPool<FetcherRequest, FetcherCommand>;
  private fetching: boolean;
  private readonly labelIndex: WorldBoundsQuadtree<IndexedLabel>;
  private readonly labels: Map<string, IndexedLabel>;
  private readonly loader: QueuedWorkerPool<LoaderRequest, LoaderResponse>;
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
  private generation: number;
  private lastRenderGeneration: number;
  private lastLabelId: number;
  private styleZoom: number;

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
    this.fetcher = new WorkerPool('/static/xyz_data_fetcher_worker.js', 1);
    this.fetching = false;
    this.labelIndex = new WorldBoundsQuadtree();
    this.labels = new Map();
    this.loader = new QueuedWorkerPool('/static/mbtile_loader_worker.js', 6);
    this.loading = new HashMap(id => `${id.zoom},${id.x},${id.y}`);
    this.rawBytes = new HashMap(id => `${id.zoom},${id.x},${id.y}`);
    this.textBuffer = new ArrayBuffer(4194304);
    this.textGlBuffer = renderer.createDataBuffer(this.textBuffer.byteLength);
    this.tiles = new HashMap(id => `${id.zoom},${id.x},${id.y}`);
    this.registerDisposer(() => {
      this.renderer.deleteBuffer(this.textGlBuffer);

      for (const response of this.tiles.values()) {
        this.renderer.deleteBuffer(response.glGeometryBuffer);
        this.renderer.deleteBuffer(response.glIndexBuffer);
      }
    });
    this.generation = 0;
    this.lastRenderGeneration = -1;
    this.lastLabelId = -1;
    // -1 is a sentinel: no styleZoom has been observed yet, so the first
    // viewportChanged adopts whatever the camera reports without triggering
    // a re-style pass (there are no cached raw bytes to re-style anyway).
    this.styleZoom = -1;

    this.fetcher.onresponse = command => {
      if (command.kind === 'ltc') {
        this.loadRawTile(command);
      } else if (command.kind === 'utc') {
        this.unloadTiles(command.ids);
      } else if (command.kind === 'usc') {
        this.fetching = command.fetching;
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

    this.fetcher.broadcast({
      kind: 'ir',
      url,
      extraZoom,
      minZoom,
      maxZoom,
    });
    this.loader.broadcast({
      kind: 'ir',
      style,
    });
  }

  override hasNewData(): boolean {
    return this.generation !== this.lastRenderGeneration;
  }

  override loadingData(): boolean {
    return this.fetching || this.loading.size > 0;
  }

  override render(planner: Planner, zoom: number): void {
    // TODO(april): this results in bad behavior like low zoom tiles drawing over what should be
    // background at high zoom. We need to drop the depth buffer and just be careful about overdraw
    // with xyz tiles. Sad.
    //
    // Orrrr we could add a tile wide quad at the start of every tile...? But then we need the
    // stencil buffer not depth.
    const sorted = [...this.tiles].sort((a, b) => b[0].zoom - a[0].zoom);
    for (const [, response] of sorted) {
      planner.add(response.drawables);
    }

    let textByteSize = 0;
    for (const label of this.labels.values()) {
      if (label.collidedMinZoom > zoom) {
        continue;
      }

      const {byteSize, drawables} = GLYPHER.plan(
          label.graphemes,
          label.center,
          [0, 0],
          label.scale,
          label.angle,
          label.fill,
          label.stroke,
          label.z,
          this.textBuffer,
          textByteSize,
          this.textGlBuffer,
          this.renderer);
      planner.add(drawables);
      textByteSize += byteSize;
    }
    this.renderer.uploadData(this.textBuffer, textByteSize, this.textGlBuffer);

    this.lastRenderGeneration = this.generation;
  }

  override viewportChanged(
      bounds: S2LatLngRect, zoom: number, fetchZoom: number, cone?: SphericalCone): void {
    const lat = bounds.lat();
    const lng = bounds.lng();
    this.fetcher.post({
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
      for (const [id, data] of this.rawBytes) {
        // Structured-clone copies for the worker; main-thread buffer is
        // preserved for future re-style passes.
        const task = this.loader.post({
          kind: 'lr',
          id,
          styleZoom: newStyleZoom,
          data,
        });
        this.loading.set(id, task);
      }
    }
  }

  private loadRawTile(command: LoadTileCommand): void {
    if (command.data.byteLength === 0) {
      return;
    }

    const id = command.id;
    this.rawBytes.set(id, command.data);
    // No transfer list: structured-clone gives the worker its own copy and
    // leaves the cached buffer intact for later re-styling.
    const task = this.loader.post({
      kind: 'lr',
      id,
      styleZoom: this.styleZoom,
      data: command.data,
    });
    this.loading.set(id, task);
  }

  private loadProcessedTile(response: LoadResponse): void {
    // A new request for this tile at a different styleZoom has already gone
    // out; discard this stale styled output.
    if (response.styleZoom !== this.styleZoom) {
      return;
    }

    for (const label of response.labels) {
      if (!GLYPHER.measurePx(label.graphemes, label.scale)) {
        // yolo!
        setTimeout(() => { this.loadProcessedTile(response); });
        return;
      }
    }

    // If we're replacing a previously-styled entry for this tile (re-style
    // path), tear down its GL buffers and unwind its label ownership before
    // installing the new entry so neither leaks.
    const affectedLabels = new Set<IndexedLabel>();
    this.disposeStyledTile(response.id, affectedLabels);

    const geometry = this.renderer.createDataBuffer(response.geometry.byteLength);
    const index = this.renderer.createIndexBuffer(response.index.byteLength);
    this.renderer.uploadData(response.geometry, response.geometry.byteLength, geometry);
    this.renderer.uploadIndices(response.index, response.index.byteLength, index);
    const drawables = [];

    const labelKeys: string[] = [];
    const ownerKey = tileKey(response.id);
    const padding = 2;
    for (const label of response.labels) {
      const key = labelKey(label);
      const existing = this.labels.get(key);
      if (existing) {
        existing.owners.add(ownerKey);
        labelKeys.push(key);

        // Different zoom-band tile styles can produce the same point label with different
        // [minZoom, maxZoom] ranges. Take the union so the label remains visible across all
        // zooms where some contributing style says it should show.
        if (label.minZoom < existing.minZoom || label.maxZoom > existing.maxZoom) {
          const newMin = Math.min(existing.minZoom, label.minZoom);
          const newMax = Math.max(existing.maxZoom, label.maxZoom);
          if (newMin < existing.minZoom) {
            // Bound scales inversely with minZoom; widening minZoom downward grows the bound.
            this.labelIndex.delete(existing.bound);
            const [w, h] = existing.radius;
            existing.bound =
                labelBound(
                    existing.center, w + SAME_TEXT_PAD_PX, h + SAME_TEXT_PAD_PX, newMin);
            this.labelIndex.insert(existing, existing.bound);
          }
          existing.minZoom = newMin;
          existing.maxZoom = newMax;
          existing.collidedMinZoom = newMin;
          this.recalculateCollisionZoom(existing);
        }
        continue;
      }

      const [wr, hr] = checkExists(GLYPHER.measurePx(label.graphemes, label.scale));
      const sin = Math.sin(label.angle);
      const cos = Math.cos(label.angle);
      // TODO(april): this isn't quite right. I think you can rotate the top right corner in such a
      // way that it's no longer representative of the actual rotated width. I think need a Math.max
      // on another corner here.
      const w = Math.abs(wr * cos - hr * sin) + 2 * padding;
      const h = Math.abs(wr * sin + hr * cos) + 2 * padding;
      // Pad the bound by SAME_TEXT_PAD_PX so queryRect surfaces same-text neighbors at the
      // padded collision range. radius stays at [w, h] for the actual collision math.
      const maximalBound =
          labelBound(
              label.center, w + SAME_TEXT_PAD_PX, h + SAME_TEXT_PAD_PX, label.minZoom);

      const indexed: IndexedLabel = {
        ...label,
        id: ++this.lastLabelId,
        key,
        owners: new Set([ownerKey]),
        bound: maximalBound,
        collidedMinZoom: label.minZoom,
        radius: [w, h] as const, // no divide by 2 because the world is -1 to 1
      };
      this.recalculateCollisionZoom(indexed);

      this.labels.set(key, indexed);
      this.labelIndex.insert(indexed, maximalBound);
      labelKeys.push(key);
    }

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
    });
    // Recalculate collidedMinZoom for labels whose neighbor was just removed
    // by the dispose pass above. Done after the new labels are installed so
    // those new labels participate in the recomputed collisions.
    for (const label of affectedLabels) {
      this.recalculateCollisionZoom(label);
    }
    this.generation += 1;

    this.fetcher.broadcast({
      kind: 'tlr',
      id: response.id,
    });
  }

  private disposeStyledTile(id: TileId, affectedLabels: Set<IndexedLabel>): void {
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
      if (label.owners.size > 0) {
        continue;
      }

      this.labels.delete(key);
      affectedLabels.delete(label);
      this.labelIndex.delete(label.bound);

      const affected: IndexedLabel[] = [];
      this.labelIndex.queryRect(label.bound, affected);
      for (const other of affected) {
        // TODO(april): can we skip labels we know we didn't affect?
        affectedLabels.add(other);
      }
    }
  }

  private unloadTiles(ids: TileId[]): void {
    const affectedLabels = new Set<IndexedLabel>();
    for (const id of ids) {
      const task = this.loading.get(id);
      if (task) {
        this.loading.delete(id);
        task.cancel();
      }

      this.rawBytes.delete(id);
      this.disposeStyledTile(id, affectedLabels);
    }

    // We recalculate after all tiles are unloaded because we may be unloading every label.
    for (const label of affectedLabels) {
      this.recalculateCollisionZoom(label);
    }

    this.generation += 1;
  }

  private recalculateCollisionZoom(label: IndexedLabel): void {
    const neighbors: IndexedLabel[] = [];
    this.labelIndex.queryRect(label.bound, neighbors);

    let ourMinZoom = label.minZoom;
    const [wr, hr] = label.radius;
    for (const other of neighbors) {
      if (other === label) {
        continue;
      }
      if (label.maxZoom < other.minZoom || label.minZoom > other.maxZoom) {
        continue;
      }


      const collisionZoom = Math.max(ourMinZoom, other.collidedMinZoom);
      const worldSize = 256 * Math.pow(2, collisionZoom);

      const extraPad =
          arrays.equals(label.graphemes, other.graphemes)
              ? SAME_TEXT_PAD_PX
              : DIFFERENT_TEXT_PAD_PX;
      const ourRadius = [wr / worldSize, hr / worldSize];
      const theirRadius = [other.radius[0] / worldSize, other.radius[1] / worldSize];
      const overlapX =
          Math.abs(label.center[0] - other.center[0])
              - ourRadius[0] - theirRadius[0] - extraPad / worldSize;
      const overlapY =
          Math.abs(label.center[1] - other.center[1])
              - ourRadius[1] - theirRadius[1] - extraPad / worldSize;
      if (overlapX >= 0 || overlapY >= 0) {
        continue;
      }

      const minimalZoomX =
          Math.log2(
              (wr + other.radius[0] + extraPad)
                  / Math.abs(label.center[0] - other.center[0]) / 512);
      const minimalZoomY =
          Math.log2(
              (hr + other.radius[1] + extraPad)
                  / Math.abs(label.center[1] - other.center[1]) / 512);
      const minimalZoom = Math.max(minimalZoomX, minimalZoomY);

      if (label.z > other.z) {
        other.collidedMinZoom = Math.max(minimalZoom, other.collidedMinZoom);
      } else if (label.z === other.z) {
        const compare = arrays.compare(label.graphemes, other.graphemes);
        if (compare < 0 || (compare === 0 && label.id < other.id)) {
          other.collidedMinZoom = Math.max(minimalZoom, other.collidedMinZoom);
        } else {
          ourMinZoom = Math.max(ourMinZoom, minimalZoom);
        }
      } else {
        ourMinZoom = Math.max(ourMinZoom, minimalZoom);
      }
    }

    label.collidedMinZoom = ourMinZoom;
  }
}

