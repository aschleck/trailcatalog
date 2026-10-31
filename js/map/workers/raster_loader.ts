import { checkExhaustive } from 'external/dev_april_corgi+/js/common/asserts';

import { TileId } from '../common/types';

import { Reply, serveClients } from './client_pool';
import { readTerrarium, terrariumMeters } from './terrarium';
import { colorWeather, readPacked, SNOW_DEPTH_CM, unpackSnodas, WeatherView } from './weather';

// How to draw a tile. 'image' draws it as is, 'elevation' colors a terrarium tile by height,
// 'hillshade' fades a gray hillshade by its shade, the snow kinds color one of the values in a
// SNODAS tile, and the weather kinds color an ECMWF tile.
export type Decode =
    'elevation'|'hillshade'|'image'|'snow_depth'|'snow_water'|`weather/${WeatherView}`;

export interface Initialize {
  decode: Decode;
}

interface LoadRequest {
  kind: 'lr';
  id: TileId;
  data: ArrayBuffer;
}

export type Request = LoadRequest;

export interface LoadResponse {
  kind: 'lr';
  id: TileId;
  bitmap: ImageBitmap;
  // The tile's RGBA before coloring, for the decodes whose pixels pack values worth reading back
  packed: Uint8ClampedArray|undefined;
}

export type Response = LoadResponse;

const SNOW_ALPHA = 160;
// Depth and water use the same colors so a depth and its water look the same.
const SNOW_COLORS = SNOW_DEPTH_CM.map(([, color]) => color);
// The value where each color starts. Settled snow is about 30% water, so 1 cm of snow is about 3 mm
// of water, and the water stops are the depth stops times 3.
const SNOW_DEPTH_CM_STOPS = SNOW_DEPTH_CM.map(([cm]) => cm);
const SNOW_WATER_MM_STOPS = SNOW_DEPTH_CM_STOPS.map(cm => 3 * cm);

// Green lowlands through tan and brown to white peaks, interpolated between stops
const ELEVATION_METER_STOPS = [0, 100, 300, 600, 1000, 1500, 2200, 3000, 4000, 4800, 5600];
const ELEVATION_COLORS = [
  0x377A26, 0x4A9A3A, 0x92C672, 0xEEE6B0, 0xE3C58A, 0xC98A4C, 0xA85A28, 0x8C3A20, 0x7A2A28, 0xB4ACAC,
  0xFFFFFF,
];

class RasterLoader {

  constructor(private readonly decode: Decode) {}

  async render(request: LoadRequest): Promise<Reply<Response>> {
    const blob = new Blob([request.data]);
    let bitmap;
    let packed;
    if (this.decode === 'image') {
      bitmap = await createImageBitmap(blob);
    } else if (this.decode === 'elevation') {
      packed = await readTerrarium(blob);
      bitmap = await colorElevation(packed);
    } else if (this.decode === 'hillshade') {
      const pixels = await readPacked(blob);
      alphaFromShade(pixels.data);
      bitmap = await createImageBitmap(pixels);
    } else {
      const pixels = await readPacked(blob);
      packed = pixels.data.slice();
      if (this.decode === 'snow_depth' || this.decode === 'snow_water') {
        colorSnow(pixels.data, this.decode === 'snow_depth');
      } else {
        colorWeather(this.decode.substring('weather/'.length) as WeatherView, pixels.data);
      }
      bitmap = await createImageBitmap(pixels);
    }
    return {
      message: {
        kind: 'lr',
        id: request.id,
        bitmap,
        packed,
      },
      transfer: packed ? [bitmap, packed.buffer] : [bitmap],
    };
  }
}

// Lit slopes are light and fade out so that only shadows darken the map. Keep in sync with
// Hillshader.kt#main.
function alphaFromShade(rgba: Uint8ClampedArray): void {
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] > 0) {
      rgba[i + 3] = 275 - rgba[i]; // clamps to 255 below a gray of 20
    }
  }
}

function colorSnow(rgba: Uint8ClampedArray, depth: boolean): void {
  const stops = depth ? SNOW_DEPTH_CM_STOPS : SNOW_WATER_MM_STOPS;
  for (let i = 0; i < rgba.length; i += 4) {
    const snow = unpackSnodas((rgba[i] << 16) | (rgba[i + 1] << 8) | rgba[i + 2]);
    const value = depth ? snow?.depthCm : snow?.waterMm;
    let band = -1;
    while (value !== undefined && band + 1 < stops.length && stops[band + 1] <= value) {
      band += 1;
    }
    if (band < 0) {
      rgba[i + 3] = 0;
      continue;
    }
    const color = SNOW_COLORS[band];
    rgba[i + 0] = color >>> 16;
    rgba[i + 1] = (color >>> 8) & 0xFF;
    rgba[i + 2] = color & 0xFF;
    rgba[i + 3] = SNOW_ALPHA;
  }
}

// Mapterhorn has no bathymetry and stores the sea as 0 m, but so does land on the 0 m contour after
// its quantization, so we color the sea as lowland and leave it to the basemap's water to cover.
function colorElevation(terrarium: Uint8ClampedArray): Promise<ImageBitmap> {
  const size = Math.sqrt(terrarium.length / 4);
  const pixels = new ImageData(size, size);
  const rgba = pixels.data;
  const last = ELEVATION_METER_STOPS.length - 1;
  for (let i = 0; i < size * size; ++i) {
    const m =
        terrariumMeters(
            (terrarium[4 * i] << 16) | (terrarium[4 * i + 1] << 8) | terrarium[4 * i + 2]);
    let band = 0;
    while (band + 1 < last && ELEVATION_METER_STOPS[band + 1] <= m) {
      band += 1;
    }
    const lo = ELEVATION_METER_STOPS[band];
    const hi = ELEVATION_METER_STOPS[band + 1];
    const t = Math.min(Math.max((m - lo) / (hi - lo), 0), 1);
    const from = ELEVATION_COLORS[band];
    const to = ELEVATION_COLORS[band + 1];
    for (let c = 0; c < 3; ++c) {
      const shift = 16 - 8 * c;
      const a = (from >>> shift) & 0xFF;
      const b = (to >>> shift) & 0xFF;
      rgba[4 * i + c] = a + (b - a) * t;
    }
    rgba[4 * i + 3] = 0xFF;
  }
  return createImageBitmap(pixels);
}

serveClients<Initialize, Request, Response>(init => {
  const loader = new RasterLoader(init.decode);
  return request => {
    if (request.kind === 'lr') {
      return loader.render(request);
    } else {
      throw checkExhaustive(request.kind);
    }
  };
});

