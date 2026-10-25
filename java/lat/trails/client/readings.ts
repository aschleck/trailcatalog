import {
  byPeakWindow,
  byWindLevel,
  PEAK_WINDOWS,
  relativeHumidity,
  SNOW_TYPES,
  thunders,
  unpackPixel,
  unpackSnodas,
  Values,
  WEATHER_VIEWS,
  WeatherView,
  wetBulb,
} from 'js/map/workers/weather';
import { terrariumMeters } from 'js/map/workers/terrarium';
import { formatHeight, formatTemperature, shouldUseImperial } from 'js/units/formatters';

const NO_DATA = 'No data';
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const KMH_PER_MPS = 3.6;
const MPH_PER_MPS = 2.236936;
const MM_PER_INCH = 25.4;
// Ellrod's index in 10^-7 s^-2, see WeatherLayers.kt#TURBULENCE_LAYERS
const TURBULENCE_LEVELS: Array<[number, string]> = [[12, 'Severe'], [8, 'Moderate'], [4, 'Light']];
// See WeatherLayers.kt#computeIcing
const ICING_MAX = 15;

const WHOLE = new Intl.NumberFormat(undefined, {maximumFractionDigits: 0});
const TENTHS = new Intl.NumberFormat(undefined, {maximumFractionDigits: 1});
const HUNDREDTHS = new Intl.NumberFormat(undefined, {maximumFractionDigits: 2});
// Unit ages run from thousands of years to billions, so a fixed number of decimals either drops
// the Holocene to 0 or pads the Precambrian.
const MILLIONS_OF_YEARS = new Intl.NumberFormat(undefined, {maximumSignificantDigits: 3});

const READERS = {
  wind,
  gust: wind,
  ...byWindLevel(level => [
    [`wind_${level}`, wind],
    ...PEAK_WINDOWS.map(hours => [`wind_${level}_peak_${hours}`, wind] as const),
  ] as const),
  ...byPeakWindow(hours => [
    [`wind_peak_${hours}`, wind],
    [`gust_peak_${hours}`, wind],
  ] as const),
  pressure: v => known(v.pressure, hpa => `${WHOLE.format(hpa)} hPa`),
  temperature: v => temperature(v.temperature),
  dew_point: v => temperature(v.dew_point),
  humidity: v => percent(relativeHumidity(v.temperature, v.dew_point)),
  wet_bulb: v => temperature(wetBulb(v.temperature, relativeHumidity(v.temperature, v.dew_point))),
  precipitation: precipitation,
  rain_12: v => water(v.next_12h),
  rain_24: v => water(v.next_24h),
  rain_72: v => water(v.next_72h),
  rain_120: v => water(v.next_120h),
  snowfall_12: v => snowWater(v.next_12h),
  snowfall_24: v => snowWater(v.next_24h),
  snowfall_72: v => snowWater(v.next_72h),
  snowfall_120: v => snowWater(v.next_120h),
  snow_depth: v => snowDepth(v.depth),
  clouds: v => percent(v.total),
  low_clouds: v => percent(v.low),
  medium_clouds: v => percent(v.medium),
  high_clouds: v => percent(v.high),
  thermals: v => height(v.top),
  freezing: v => height(v.altitude),
  // land has no waves, so every channel is missing together
  waves: v => known(v.height, () =>
      `${height(v.height)} from ${compass(v.direction)} every ${WHOLE.format(v.period)} s`),
  icing_850: v => icing(v['850hpa']),
  icing_700: v => icing(v['700hpa']),
  icing_600: v => icing(v['600hpa']),
  icing_500: v => icing(v['500hpa']),
  icing_400: v => icing(v['400hpa']),
  icing_300: v => icing(v['300hpa']),
  turbulence_400_300: v => turbulence(v['400_300hpa']),
  turbulence_300_250: v => turbulence(v['300_250hpa']),
  turbulence_250_200: v => turbulence(v['250_200hpa']),
  turbulence_200_150: v => turbulence(v['200_150hpa']),
} satisfies Record<WeatherView, (values: Values) => string>;

/** Describes what a weather view shows at a pixel from the pixel's 24 packed bits. */
export function readWeather(view: WeatherView, packed: number): string {
  return READERS[view](unpackPixel(WEATHER_VIEWS[view].layer, packed));
}

/** Describes the snow depth or water at a SNODAS pixel from its 24 packed bits. */
export function readSnodas(depth: boolean, packed: number): string {
  const snow = unpackSnodas(packed);
  if (!snow) {
    return NO_DATA;
  }
  return depth ? snowDepth(snow.depthCm) : water(snow.waterMm);
}

/** Describes the height of a terrarium pixel from its 24 packed bits. */
export function readElevation(packed: number): string {
  return height(terrariumMeters(packed));
}

/** Describes a Macrostrat unit from its tile properties, one row per fact the map has. */
export function readGeology(unit: Record<string, unknown>): Array<{name: string; value: string}> {
  const rows: Array<{name: string; value: string}> = [];
  const add = (name: string, value: unknown) => {
    if (typeof value === 'string' && value) {
      rows.push({name, value});
    }
  };
  add('Unit', unit.name);
  add('Rock', typeof unit.lith === 'string' ? getLithology(unit.lith) : undefined);
  const top = unit.best_age_top;
  const bottom = unit.best_age_bottom;
  if (typeof top === 'number' && typeof bottom === 'number') {
    const range = `${MILLIONS_OF_YEARS.format(bottom)} to ${MILLIONS_OF_YEARS.format(top)} Ma`;
    add('Age', unit.age ? `${unit.age}, ${range}` : range);
  } else {
    add('Age', unit.age);
  }
  add('Source', unit.ref_year ? `${unit.ref_source} (${unit.ref_year})` : unit.ref_source);
  return rows;
}

// Some compilations write lithology as `Major:{coarse alluvium}, Minor:{fine alluvium}`, which we
// read as "coarse alluvium, minor fine alluvium".
function getLithology(lith: string): string {
  const parts = [...lith.matchAll(/(\w+):\{([^}]*)\}/g)];
  if (parts.length === 0) {
    return lith;
  }
  return parts
      .map(([, label, text]) => label === 'Major' ? text : `${label.toLowerCase()} ${text}`)
      .join(', ');
}

function precipitation(v: Values): string {
  if (isNaN(v.rate)) {
    return NO_DATA;
  } else if (v.rate < 0.1) {
    return 'None';
  }
  const rate =
      shouldUseImperial()
          ? `${HUNDREDTHS.format(v.rate / MM_PER_INCH)} in/h`
          : `${TENTHS.format(v.rate)} mm/h`;
  const what = SNOW_TYPES.has(v.type) ? `${rate} of snow` : rate;
  return thunders(v) ? `${what} with thunder` : what;
}

function wind({u, v}: Values): string {
  // u and v are where the wind blows toward, and wind is named for where it comes from.
  const from = Math.atan2(-u, -v) * 180 / Math.PI;
  return known(u, () => `${speed(Math.hypot(u, v))} from ${compass(from)}`);
}

function speed(mps: number): string {
  return known(mps, () =>
      shouldUseImperial()
          ? `${WHOLE.format(mps * MPH_PER_MPS)} mph`
          : `${WHOLE.format(mps * KMH_PER_MPS)} km/h`);
}

function compass(degrees: number): string {
  return COMPASS[Math.round(((degrees % 360) + 360) % 360 / 45) % COMPASS.length];
}

function temperature(celsius: number): string {
  return known(celsius, () => {
    const {value, unit} = formatTemperature(celsius);
    return `${value} ${unit}`;
  });
}

function height(meters: number): string {
  return known(meters, () => {
    const {value, unit} = formatHeight(meters);
    return `${value} ${unit}`;
  });
}

function percent(value: number): string {
  return known(value, () => `${WHOLE.format(value)}%`);
}

function water(mm: number): string {
  return known(mm, () =>
      shouldUseImperial()
          ? `${HUNDREDTHS.format(mm / MM_PER_INCH)} in`
          : `${TENTHS.format(mm)} mm`);
}

// ECMWF totals snowfall as the water it melts to
function snowWater(mm: number): string {
  return known(mm, () => `${water(mm)} of water`);
}

// Inches keep a decimal because the layer colors from 1 cm, which is 0.4 in.
function snowDepth(cm: number): string {
  return known(cm, () =>
      shouldUseImperial()
          ? `${TENTHS.format(10 * cm / MM_PER_INCH)} in`
          : `${WHOLE.format(cm)} cm`);
}

function icing(index: number): string {
  return known(index, () => index < 1 ? 'None' : `${WHOLE.format(index)} of ${ICING_MAX}`);
}

function turbulence(index: number): string {
  const level = TURBULENCE_LEVELS.find(([threshold]) => index >= threshold);
  return known(index, () => level ? `${level[1]}, ${TENTHS.format(index)}` : 'None');
}

function known(value: number, format: (value: number) => string): string {
  return isNaN(value) ? NO_DATA : format(value);
}
