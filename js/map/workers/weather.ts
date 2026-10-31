import { ICING_LEVELS, PEAK_WINDOWS, TURBULENCE_LAYERS, WIND_LEVELS } from 'java/lat/trails/wire/wire';

// Each pixel's 24 RGB bits hold the channels packed from the high bits down as
// round((value - offset) / scale), and a channel's largest code means no data. Every archive of a
// run carries the run's formats in its metadata, see WeatherLayers.kt#formatsJson.
export interface Channel {
  name: string;
  bits: number;
  scale: number;
  offset: number;
}

export interface EcmwfFormat {
  stepHours: number;
  // Set when each step looks this many hours ahead, so the last steps of a run have no tiles
  lookaheadHours?: number;
  channels: Channel[];
}

// The json metadata of every archive in a run, see WeatherLayers.kt#formatsJson
export interface EcmwfRunFormat {
  // the last forecast hour the run tiles
  maxStep: number;
  maxZoom: number;
  // in pixels on a side
  tileSize: number;
  // by archive
  layers: Record<string, EcmwfFormat>;
}

export { PEAK_WINDOWS, WIND_LEVELS };

type WindLevel = typeof WIND_LEVELS[number];
type PeakWindow = typeof PEAK_WINDOWS[number];
// Like 400_300 for [400, 300]
type TurbulenceName<L> =
    L extends readonly [infer B extends number, infer T extends number] ? `${B}_${T}` : never;

export function byWindLevel<K extends string, V>(
    entries: (level: WindLevel) => ReadonlyArray<readonly [K, V]>): Record<K, V> {
  return Object.fromEntries(WIND_LEVELS.flatMap(entries)) as Record<K, V>;
}

export function byPeakWindow<K extends string, V>(
    entries: (hours: PeakWindow) => ReadonlyArray<readonly [K, V]>): Record<K, V> {
  return Object.fromEntries(PEAK_WINDOWS.flatMap(entries)) as Record<K, V>;
}

/** Channel values by name, NaN where a channel has no data. */
export type Values = Record<string, number>;
type Rgba = [number, number, number, number];
type Ramp = Array<[number, number]>;

interface View {
  // the archive it reads
  layer: string;
  // undefined leaves the pixel clear
  color: (values: Values) => Rgba|undefined;
}

const ALPHA = 180;

// Value to 0xRRGGBB stops, interpolated between and clamped past the ends
const TEMPERATURE_C: Ramp = [
  [-40, 0x3C006E], [-25, 0x3C3CBE], [-10, 0x4696DC], [0, 0x96D7E6], [10, 0xAADC8C],
  [20, 0xFADC5A], [30, 0xF58232], [40, 0xBE1E28], [50, 0x6E001E],
];
const SPEED_MPS: Ramp = [
  [0, 0x6271B7], [3, 0x39619F], [6, 0x4A94A9], [9, 0x4D8D7B], [12, 0x53A553], [15, 0xA79D51],
  [20, 0x9F7F3A], [25, 0xA16C5C], [30, 0x813A4E], [40, 0xAF5088], [50, 0x754A93],
];
const PRESSURE_HPA: Ramp = [
  [960, 0x4B2991], [990, 0x3C6EC8], [1005, 0x50AAAA], [1013, 0x8CC864], [1025, 0xE6C850],
  [1040, 0xD2643C],
];
const HUMIDITY_PERCENT: Ramp = [[0, 0xAD5538], [40, 0xD9B36C], [70, 0x6FB28A], [100, 0x2F5FA8]];
const RAIN_MM_PER_HOUR: Ramp = [
  [0.1, 0xA0D8EF], [0.5, 0x4FA3E0], [2, 0x2A6BD1], [5, 0x3AB54A], [10, 0xF2E33A], [20, 0xF28C28],
  [50, 0xD7263D],
];
const SNOW_MM_PER_HOUR: Ramp = [[0.1, 0xE6E6F5], [1, 0xB4A0E6], [5, 0x8C5AC8]];
const ACCUMULATION_MM: Ramp = [
  [1, 0xA0D8EF], [5, 0x4FA3E0], [10, 0x2A6BD1], [25, 0x3AB54A], [50, 0xF2E33A], [100, 0xF28C28],
  [200, 0xD7263D],
];
// Light to dark, and shared with raster_loader.ts so SNODAS and ECMWF snow read alike
export const SNOW_DEPTH_CM: Ramp = [
  [1, 0xDCEFFA], [5, 0xB5DAF2], [15, 0x85BDE6], [30, 0x5A9DD8], [60, 0x3A7BC8], [100, 0x3F55B5],
  [150, 0x5A3FA0], [200, 0x77308A], [300, 0x8E1F6E],
];
const ALTITUDE_M: Ramp = [
  [0, 0x8C3A20], [500, 0xC98A4C], [1000, 0xEEE6B0], [2000, 0x92C672], [3000, 0x4FA3E0],
  [4500, 0x3C3CBE], [6000, 0x4B2991],
];
// Ellrod's index in 10^-7 s^-2, where 4 is light, 8 moderate, and 12 severe
const TURBULENCE: Ramp = [[2, 0xF5E6A0], [4, 0xF2C53A], [8, 0xF28C28], [12, 0xD7263D]];
const ICING: Ramp = [[1, 0xC8E6F5], [5, 0x6FB2E0], [10, 0x3C6EC8], [15, 0x4B2991]];
const WAVE_HEIGHT_M: Ramp = [
  [0, 0x2F5FA8], [1, 0x4A94A9], [2, 0x53A553], [4, 0xE6C850], [6, 0xF28C28], [9, 0xD7263D],
  [14, 0x754A93],
];

// https://codes.ecmwf.int/grib/param-db/260015
export const SNOW_TYPES = new Set([5, 6, 7]);
// Convective energy above this is enough for thunderstorms where it also rains hard.
const THUNDER_CAPE = 1000;
const THUNDER_MM_PER_HOUR = 1;
const THUNDER_COLOR: Rgba = [230, 40, 200, ALPHA];

export const WEATHER_VIEWS = {
  wind: windView('wind'),
  gust: windView('wind_gust'),
  ...byWindLevel(level => [
    [`wind_${level}`, windView(`wind_${level}`)],
    ...PEAK_WINDOWS.map(hours =>
        [`wind_${level}_peak_${hours}`, windView(`peak_wind_${level}_${hours}`)] as const),
  ] as const),
  ...byPeakWindow(hours => [
    [`wind_peak_${hours}`, windView(`peak_wind_${hours}`)],
    [`gust_peak_${hours}`, windView(`peak_gust_${hours}`)],
  ] as const),
  pressure: {layer: 'pressure', color: v => ramp(PRESSURE_HPA, v.pressure)},
  temperature: {layer: 'temperature', color: v => ramp(TEMPERATURE_C, v.temperature)},
  dew_point: {layer: 'temperature', color: v => ramp(TEMPERATURE_C, v.dew_point)},
  humidity: {
    layer: 'temperature',
    color: v => ramp(HUMIDITY_PERCENT, relativeHumidity(v.temperature, v.dew_point)),
  },
  wet_bulb: {
    layer: 'temperature',
    color: v =>
        ramp(
            TEMPERATURE_C,
            wetBulb(v.temperature, relativeHumidity(v.temperature, v.dew_point))),
  },
  precipitation: {layer: 'precipitation', color: precipitationColor},
  rain_12: {layer: 'rain', color: v => ramp(ACCUMULATION_MM, v.next_12h, 1)},
  rain_24: {layer: 'rain', color: v => ramp(ACCUMULATION_MM, v.next_24h, 1)},
  rain_72: {layer: 'rain_long', color: v => ramp(ACCUMULATION_MM, v.next_72h, 1)},
  rain_120: {layer: 'rain_long', color: v => ramp(ACCUMULATION_MM, v.next_120h, 1)},
  // in mm of water, about a cm of snow each
  snowfall_12: {layer: 'snowfall', color: v => ramp(ACCUMULATION_MM, v.next_12h, 1)},
  snowfall_24: {layer: 'snowfall', color: v => ramp(ACCUMULATION_MM, v.next_24h, 1)},
  snowfall_72: {layer: 'snowfall_long', color: v => ramp(ACCUMULATION_MM, v.next_72h, 1)},
  snowfall_120: {layer: 'snowfall_long', color: v => ramp(ACCUMULATION_MM, v.next_120h, 1)},
  snow_depth: {layer: 'snow', color: v => ramp(SNOW_DEPTH_CM, v.depth, 1)},
  clouds: {layer: 'clouds', color: v => cloudColor(v.total)},
  low_clouds: {layer: 'clouds', color: v => cloudColor(v.low)},
  medium_clouds: {layer: 'clouds', color: v => cloudColor(v.medium)},
  high_clouds: {layer: 'clouds', color: v => cloudColor(v.high)},
  thermals: {layer: 'thermals', color: v => ramp(ALTITUDE_M, v.top)},
  freezing: {layer: 'freezing', color: v => ramp(ALTITUDE_M, v.altitude)},
  waves: {layer: 'waves', color: v => ramp(WAVE_HEIGHT_M, v.height)},
  ...Object.fromEntries(ICING_LEVELS.map(level => [`icing_${level}`, icingView(level)])) as
      Record<`icing_${typeof ICING_LEVELS[number]}`, View>,
  ...Object.fromEntries(TURBULENCE_LAYERS.map(([bottom, top]) =>
      [`turbulence_${bottom}_${top}`, turbulenceView(`${bottom}_${top}`)])) as
      Record<`turbulence_${TurbulenceName<typeof TURBULENCE_LAYERS[number]>}`, View>,
} satisfies Record<string, View>;

export type WeatherView = keyof typeof WEATHER_VIEWS;

/** Colors a tile's packed pixels in place. */
export function colorWeather(
    view: WeatherView, channels: Channel[], rgba: Uint8ClampedArray): void {
  const {color}: View = WEATHER_VIEWS[view];
  const values: Values = {};
  for (let i = 0; i < rgba.length; i += 4) {
    unpackPixel(channels, (rgba[i] << 16) | (rgba[i + 1] << 8) | rgba[i + 2], values);
    const rgbaOut = color(values);
    if (rgbaOut) {
      rgba.set(rgbaOut, i);
    } else {
      rgba[i + 3] = 0;
    }
  }
}

/** Unpacks every channel of a pixel's 24 packed bits into values. */
export function unpackPixel(channels: Channel[], packed: number, values: Values = {}): Values {
  let shift = 24;
  for (const channel of channels) {
    shift -= channel.bits;
    const noData = (1 << channel.bits) - 1;
    const code = (packed >>> shift) & noData;
    values[channel.name] = code === noData ? NaN : channel.offset + channel.scale * code;
  }
  return values;
}

/** Unpacks one channel of each of a tile's packed pixels, with NaN where there's no data. */
export function unpackChannel(
    channels: Channel[], name: string, rgba: Uint8ClampedArray): Float32Array {
  let shift = 24;
  let channel;
  for (channel of channels) {
    shift -= channel.bits;
    if (channel.name === name) {
      break;
    }
  }
  if (channel?.name !== name) {
    throw new Error(`No channel ${name}`);
  }
  const noData = (1 << channel.bits) - 1;
  const values = new Float32Array(rgba.length / 4);
  for (let i = 0; i < values.length; ++i) {
    const packed = (rgba[4 * i] << 16) | (rgba[4 * i + 1] << 8) | rgba[4 * i + 2];
    const code = (packed >>> shift) & noData;
    values[i] = code === noData ? NaN : channel.offset + channel.scale * code;
  }
  return values;
}

// Keep in sync with Snodas.kt#pack. Each pixel's 24 RGB bits hold snow depth in cm in the high 12
// bits and snow water equivalent in mm in the low 12 bits. A depth of 4095 means no data.
const SNODAS_NO_DATA = 4095;

/** Unpacks a SNODAS pixel's 24 packed bits, or returns undefined where it has no data. */
export function unpackSnodas(packed: number): {depthCm: number; waterMm: number}|undefined {
  const depthCm = packed >>> 12;
  return depthCm === SNODAS_NO_DATA ? undefined : {depthCm, waterMm: packed & 0xFFF};
}

// Decodes without color management or alpha premultiplication, because either would change the
// pixel values and corrupt the data.
export async function readPacked(blob: Blob): Promise<ImageData> {
  const packed =
      await createImageBitmap(blob, {colorSpaceConversion: 'none', premultiplyAlpha: 'none'});
  const canvas = new OffscreenCanvas(packed.width, packed.height);
  const context = canvas.getContext('2d', {willReadFrequently: true})!;
  context.drawImage(packed, 0, 0);
  packed.close();
  return context.getImageData(0, 0, canvas.width, canvas.height);
}

// Values below min stay clear, and so do NaNs.
function ramp(stops: Ramp, value: number, min = -Infinity): Rgba|undefined {
  if (!(value >= min)) {
    return undefined;
  }
  let band = 0;
  while (band + 2 < stops.length && stops[band + 1][0] <= value) {
    band += 1;
  }
  const [lo, from] = stops[band];
  const [hi, to] = stops[Math.min(band + 1, stops.length - 1)];
  const t = hi === lo ? 0 : Math.min(Math.max((value - lo) / (hi - lo), 0), 1);
  const out: Rgba = [0, 0, 0, ALPHA];
  for (let c = 0; c < 3; ++c) {
    const shift = 16 - 8 * c;
    const a = (from >>> shift) & 0xFF;
    const b = (to >>> shift) & 0xFF;
    out[c] = a + (b - a) * t;
  }
  return out;
}

function windView(layer: string): View {
  return {layer, color: v => ramp(SPEED_MPS, Math.hypot(v.u, v.v))};
}

function icingView(level: number): View {
  return {layer: 'icing', color: v => ramp(ICING, v[`${level}hpa`], 1)};
}

function turbulenceView(layers: string): View {
  return {layer: 'turbulence', color: v => ramp(TURBULENCE, v[`${layers}hpa`], 2)};
}

function precipitationColor(v: Values): Rgba|undefined {
  if (!(v.rate >= 0.1)) {
    return undefined;
  }
  if (thunders(v)) {
    return THUNDER_COLOR;
  }
  return ramp(SNOW_TYPES.has(v.type) ? SNOW_MM_PER_HOUR : RAIN_MM_PER_HOUR, v.rate);
}

/** Returns whether a precipitation pixel's values are enough for a thunderstorm. */
export function thunders(v: Values): boolean {
  return v.cape >= THUNDER_CAPE && v.rate >= THUNDER_MM_PER_HOUR;
}

// White, more opaque the more cover there is
function cloudColor(percent: number): Rgba|undefined {
  if (!(percent >= 5)) {
    return undefined;
  }
  return [245, 245, 250, Math.round(220 * percent / 100)];
}

// Magnus's formula with Alduchov and Eskridge's constants
export function relativeHumidity(celsius: number, dewPoint: number): number {
  const saturation = (t: number) => Math.exp(17.625 * t / (243.04 + t));
  return Math.min(100, 100 * saturation(dewPoint) / saturation(celsius));
}

// https://doi.org/10.1175/JAMC-D-11-0143.1
export function wetBulb(celsius: number, humidity: number): number {
  return celsius * Math.atan(0.151977 * Math.sqrt(humidity + 8.313659))
      + Math.atan(celsius + humidity)
      - Math.atan(humidity - 1.676331)
      + 0.00391838 * Math.pow(humidity, 1.5) * Math.atan(0.023101 * humidity)
      - 4.686035;
}
