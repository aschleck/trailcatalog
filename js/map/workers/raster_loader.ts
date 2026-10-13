import { checkExhaustive } from 'external/dev_april_corgi+/js/common/asserts';

import { TileId } from '../common/types';

import { decodeTerrarium } from './terrarium';

// How to draw a tile. 'image' draws it as is, 'elevation' colors a terrarium tile by height, and the
// snow kinds color one of the values in a SNODAS tile.
export type Decode = 'elevation'|'image'|'snow_depth'|'snow_water';

interface InitializeRequest {
  kind: 'ir';
  decode: Decode;
}

interface LoadRequest {
  kind: 'lr';
  id: TileId;
  data: ArrayBuffer;
}

export type Request = InitializeRequest|LoadRequest;

export interface LoadResponse {
  kind: 'lr';
  id: TileId;
  bitmap: ImageBitmap;
}

export type Response = LoadResponse;

// Keep in sync with Snodas.kt#pack. Each pixel's 24 RGB bits hold snow depth in cm in the high 12
// bits and snow water equivalent in mm in the low 12 bits. A depth of 4095 means no data.
const SNOW_NO_DATA = 4095;
const SNOW_ALPHA = 160;
// Light to dark. Depth and water use the same colors so a depth and its water look the same.
const SNOW_COLORS = [
  0xDCEFFA, 0xB5DAF2, 0x85BDE6, 0x5A9DD8, 0x3A7BC8, 0x3F55B5, 0x5A3FA0, 0x77308A, 0x8E1F6E,
];
// The value where each color starts. Settled snow is about 30% water, so 1 cm of snow is about 3 mm
// of water, and the water stops are the depth stops times 3.
const SNOW_DEPTH_CM_STOPS = [1, 5, 15, 30, 60, 100, 150, 200, 300];
const SNOW_WATER_MM_STOPS = SNOW_DEPTH_CM_STOPS.map(cm => 3 * cm);

// Green lowlands through tan and brown to white peaks, interpolated between stops
const ELEVATION_METER_STOPS = [0, 100, 300, 600, 1000, 1500, 2200, 3000, 4000, 4800, 5600];
const ELEVATION_COLORS = [
  0x377A26, 0x4A9A3A, 0x92C672, 0xEEE6B0, 0xE3C58A, 0xC98A4C, 0xA85A28, 0x8C3A20, 0x7A2A28, 0xB4ACAC,
  0xFFFFFF,
];

class RasterLoader {

  constructor(
      private readonly decode: Decode,
      private readonly postMessage: (response: Response, transfer?: Transferable[]) => void,
  ) {}

  render(request: LoadRequest) {
    const blob = new Blob([request.data]);
    const bitmap =
        this.decode === 'image'
            ? createImageBitmap(blob)
            : this.decode === 'elevation'
                ? decodeElevation(blob)
                : decodeSnow(blob, this.decode === 'snow_depth');
    bitmap
        .then(bitmap => {
          this.postMessage({
            kind: 'lr',
            id: request.id,
            bitmap,
          }, [bitmap]);
        }, e => {
          console.error(e);
        });
  }
}

// Decodes without color management or alpha premultiplication, because either would change the
// pixel values and corrupt the data.
async function decodeSnow(blob: Blob, depth: boolean): Promise<ImageBitmap> {
  const packed =
      await createImageBitmap(blob, {colorSpaceConversion: 'none', premultiplyAlpha: 'none'});
  const canvas = new OffscreenCanvas(packed.width, packed.height);
  const context = canvas.getContext('2d', {willReadFrequently: true})!;
  context.drawImage(packed, 0, 0);
  packed.close();
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  const rgba = pixels.data;
  const stops = depth ? SNOW_DEPTH_CM_STOPS : SNOW_WATER_MM_STOPS;
  for (let i = 0; i < rgba.length; i += 4) {
    const packedValue = (rgba[i] << 16) | (rgba[i + 1] << 8) | rgba[i + 2];
    const depthCm = packedValue >>> 12;
    const value = depth ? depthCm : packedValue & 0xFFF;
    let band = -1;
    while (band + 1 < stops.length && stops[band + 1] <= value) {
      band += 1;
    }
    if (depthCm === SNOW_NO_DATA || band < 0) {
      rgba[i + 3] = 0;
      continue;
    }
    const color = SNOW_COLORS[band];
    rgba[i + 0] = color >>> 16;
    rgba[i + 1] = (color >>> 8) & 0xFF;
    rgba[i + 2] = color & 0xFF;
    rgba[i + 3] = SNOW_ALPHA;
  }
  return createImageBitmap(pixels);
}

// Mapterhorn has no bathymetry and stores the sea as 0 m, but so does land on the 0 m contour after
// its quantization, so we color the sea as lowland and leave it to the basemap's water to cover.
async function decodeElevation(blob: Blob): Promise<ImageBitmap> {
  const meters = await decodeTerrarium(blob);
  const size = Math.sqrt(meters.length);
  const pixels = new ImageData(size, size);
  const rgba = pixels.data;
  const last = ELEVATION_METER_STOPS.length - 1;
  for (let i = 0; i < meters.length; ++i) {
    const m = meters[i];
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

function start(ir: InitializeRequest) {
  const fetcher = new RasterLoader(ir.decode, (self as any).postMessage.bind(self));
  self.onmessage = e => {
    const request = e.data as Request;
    if (request.kind === 'ir') {
      throw new Error('Already initialized');
    } else if (request.kind === 'lr') {
      fetcher.render(request);
    } else {
      checkExhaustive(request);
    }
  };
}

self.onmessage = e => {
  const request = e.data as Request;
  if (request.kind !== 'ir') {
    throw new Error('Expected an initialization request');
  }

  start(request);
};

