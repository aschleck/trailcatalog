import { formatDistance as formatUnitDistance, formatHeight as formatUnitHeight } from 'js/units/formatters';

// Keep in sync with SimpleS2#EARTH_RADIUS_METERS. Not read from there because loading S2 here would
// keep these out of jest, which cannot load the J2CL bundle.
const EARTH_RADIUS_METERS = 6371010;

export interface LineStats {
  lengthMeters: number;
  // Undefined when the line has no elevations
  elevation: {
    upMeters: number;
    downMeters: number;
    minMeters: number;
    maxMeters: number;
  }|undefined;
}

/**
 * Measures a line the way trailcatalog measures a way: raw climb and descent summed step by step,
 * and length along the hypotenuse of each step's run and rise.
 *
 * See also CalculateWayElevations#calculateProfile.
 */
export function measureLine(
    latLngE7: ArrayLike<number>, elevationCentimeters: ArrayLike<number>|undefined): LineStats {
  const count = latLngE7.length / 2;
  let lengthMeters = 0;
  let upMeters = 0;
  let downMeters = 0;
  let minMeters = Infinity;
  let maxMeters = -Infinity;
  for (let i = 0; i < count; ++i) {
    const z = elevationCentimeters ? elevationCentimeters[i] / 100 : 0;
    minMeters = Math.min(minMeters, z);
    maxMeters = Math.max(maxMeters, z);
    if (i === 0) {
      continue;
    }

    const run =
        haversineMeters(
            latLngE7[2 * i - 2] / 1e7,
            latLngE7[2 * i - 1] / 1e7,
            latLngE7[2 * i] / 1e7,
            latLngE7[2 * i + 1] / 1e7);
    const dz = elevationCentimeters ? z - elevationCentimeters[i - 1] / 100 : 0;
    if (dz >= 0) {
      upMeters += dz;
    } else {
      downMeters -= dz;
    }
    lengthMeters += Math.hypot(run, dz);
  }

  return {
    lengthMeters,
    elevation:
        elevationCentimeters && count > 0
            ? {upMeters, downMeters, minMeters, maxMeters}
            : undefined,
  };
}

export function formatDistance(meters: number): string {
  const {value, unit} = formatUnitDistance(meters);
  return `${value} ${unit}`;
}

export function formatHeight(meters: number): string {
  const {value, unit} = formatUnitHeight(meters);
  return `${value} ${unit}`;
}

// A z12 pixel is 13 m across in the Alps and most sources under Mapterhorn are no finer than 10 m,
// so sampling closer only adds noise.
const MIN_SAMPLE_SPACING_METERS = 10;
// A few thousand samples draw a smooth profile at any panel width.
const MAX_SAMPLES = 2000;
// Circumference over the pixels across the world at zoom 0, 512 to a Mapterhorn tile
const METERS_PER_PIXEL_AT_ZOOM_0 = 2 * Math.PI * EARTH_RADIUS_METERS / 512;

export interface ProfileSamples {
  // Interleaved lat then lng, in degrees
  latLngDegrees: Float64Array;
  // Along the path to each sample
  distanceMeters: Float64Array;
  // The DEM zoom whose pixels are closest to the sample spacing
  zoom: number;
}

/**
 * Spaces samples evenly along a path, keeping every vertex so that a corner is never cut off.
 * Takes the path as interleaved lat then lng degrees.
 */
export function profileSamples(path: Float64Array): ProfileSamples {
  const count = path.length / 2;
  const segments = [];
  let total = 0;
  for (let i = 1; i < count; ++i) {
    const length =
        haversineMeters(path[2 * i - 2], path[2 * i - 1], path[2 * i], path[2 * i + 1]);
    segments.push(length);
    total += length;
  }

  const spacing = Math.max(MIN_SAMPLE_SPACING_METERS, total / MAX_SAMPLES);
  const latLngs = count > 0 ? [path[0], path[1]] : [];
  const distances = count > 0 ? [0] : [];
  let along = 0;
  for (let i = 1; i < count; ++i) {
    const length = segments[i - 1];
    const steps = Math.max(1, Math.ceil(length / spacing));
    for (let step = 1; step <= steps; ++step) {
      const f = step / steps;
      latLngs.push(
          path[2 * i - 2] + (path[2 * i] - path[2 * i - 2]) * f,
          path[2 * i - 1] + (path[2 * i + 1] - path[2 * i - 1]) * f);
      distances.push(along + length * f);
    }
    along += length;
  }

  const latitude = count > 0 ? path[0] * Math.PI / 180 : 0;
  const zoom =
      Math.round(Math.log2(METERS_PER_PIXEL_AT_ZOOM_0 * Math.cos(latitude) / spacing));
  return {
    latLngDegrees: Float64Array.from(latLngs),
    distanceMeters: Float64Array.from(distances),
    zoom: Math.min(14, Math.max(12, zoom)),
  };
}

export interface ProfileStats {
  upMeters: number;
  downMeters: number;
  minMeters: number;
  medianMeters: number;
  maxMeters: number;
}

/** Sums raw climb and descent between samples, the way measureLine does between vertices. */
export function profileStats(meters: ArrayLike<number>): ProfileStats {
  let up = 0;
  let down = 0;
  for (let i = 1; i < meters.length; ++i) {
    const dz = meters[i] - meters[i - 1];
    if (dz >= 0) {
      up += dz;
    } else {
      down -= dz;
    }
  }
  const sorted = Array.from(meters).sort((a, b) => a - b);
  return {
    upMeters: up,
    downMeters: down,
    minMeters: sorted[0] ?? 0,
    medianMeters: sorted[Math.floor(sorted.length / 2)] ?? 0,
    maxMeters: sorted[sorted.length - 1] ?? 0,
  };
}

// https://en.wikipedia.org/wiki/Haversine_formula
export function haversineMeters(lat0: number, lng0: number, lat1: number, lng1: number): number {
  const toRadians = Math.PI / 180;
  const dLat = (lat1 - lat0) * toRadians;
  const dLng = (lng1 - lng0) * toRadians;
  const h =
      Math.sin(dLat / 2) ** 2
          + Math.cos(lat0 * toRadians) * Math.cos(lat1 * toRadians) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
}
