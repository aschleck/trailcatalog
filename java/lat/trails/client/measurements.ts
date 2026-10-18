import {
  formatDistance as formatUnitDistance,
  formatHeight as formatUnitHeight,
  getUnitSystem,
  UnitSystem,
} from 'js/units/formatters';

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

// A recording drifts 3 or 4 m in altitude over a flat day and Copernicus quotes up to 4 m of
// relative error on steep slopes, so reversals smaller than this are noise. Real climbs lose
// nothing because only the reversal is dropped, never the climb on either side of it.
// Keep in sync with CalculateWayElevations#CLIMB_THRESHOLD_METERS.
const CLIMB_THRESHOLD_METERS = 5;

/**
 * Measures a line's climb and descent past a reversal threshold, and its length along the
 * hypotenuse of each step's run and counted rise.
 *
 * Length counts only the rise that climb does, or else a recording's altitude wobble would add to
 * its length what the threshold leaves out of its climb. A rise that only passes the threshold
 * several vertices in is spread over all of them rather than steepening the last one.
 *
 * See also CalculateWayElevations#calculateProfile.
 */
export function measureLine(
    latLngE7: ArrayLike<number>, elevationCentimeters: ArrayLike<number>|undefined): LineStats {
  const count = latLngE7.length / 2;
  let lengthMeters = 0;
  // Ground walked since the climb last counted a rise
  let heldMeters = 0;
  const climb = new ClimbCounter();
  let minMeters = Infinity;
  let maxMeters = -Infinity;
  for (let i = 0; i < count; ++i) {
    const z = elevationCentimeters ? elevationCentimeters[i] / 100 : 0;
    minMeters = Math.min(minMeters, z);
    maxMeters = Math.max(maxMeters, z);
    const rise = climb.add(z);
    if (i === 0) {
      continue;
    }

    heldMeters +=
        haversineMeters(
            latLngE7[2 * i - 2] / 1e7,
            latLngE7[2 * i - 1] / 1e7,
            latLngE7[2 * i] / 1e7,
            latLngE7[2 * i + 1] / 1e7);
    if (rise > 0) {
      lengthMeters += Math.hypot(heldMeters, rise);
      heldMeters = 0;
    }
  }

  return {
    lengthMeters: lengthMeters + heldMeters,
    elevation:
        elevationCentimeters && count > 0
            ? {upMeters: climb.upMeters, downMeters: climb.downMeters, minMeters, maxMeters}
            : undefined,
  };
}

/**
 * Returns the distance to each sample along the counted rise the way measureLine measures it,
 * given the distance along the ground to each.
 */
export function slopeMeters(groundMeters: ArrayLike<number>, meters: ArrayLike<number>):
    Float64Array {
  const along = new Float64Array(groundMeters.length);
  const climb = new ClimbCounter();
  // The sample the climb last counted a rise at. Samples after it wait for the next rise to know
  // their slope, and share its length in proportion to their ground.
  let from = 0;
  for (let i = 0; i < along.length; ++i) {
    const rise = climb.add(meters[i]);
    if (i > 0 && (rise > 0 || i === along.length - 1)) {
      const ground = groundMeters[i] - groundMeters[from];
      const sloped = Math.hypot(ground, rise);
      // Samples with no ground between them take the rise at once, or else it would go missing.
      for (let j = from + 1; j <= i; ++j) {
        const share = ground > 0 ? (groundMeters[j] - groundMeters[from]) / ground : 1;
        along[j] = along[from] + share * sloped;
      }
      from = i;
    }
  }
  return along;
}

/** Sums the great circle length of a path of interleaved lat then lng degrees. */
export function pathLengthMeters(path: ArrayLike<number>): number {
  let meters = 0;
  for (let i = 2; i < path.length; i += 2) {
    meters += haversineMeters(path[i - 2], path[i - 1], path[i], path[i + 1]);
  }
  return meters;
}

/** Returns the great circle distance along a path to each of its vertices. */
export function cumulativeMeters(path: ArrayLike<number>): Float64Array {
  const along = new Float64Array(path.length / 2);
  for (let i = 1; i < along.length; ++i) {
    along[i] =
        along[i - 1]
            + haversineMeters(path[2 * i - 2], path[2 * i - 1], path[2 * i], path[2 * i + 1]);
  }
  return along;
}

/**
 * Returns the area a ring of interleaved lat then lng degrees encloses on the sphere, whichever way
 * it winds. The ring closes back to its first vertex without repeating it.
 */
// https://trs.jpl.nasa.gov/handle/2014/41271
export function ringAreaMeters2(ring: ArrayLike<number>): number {
  const toRadians = Math.PI / 180;
  const count = ring.length / 2;
  let sum = 0;
  for (let i = 0; i < count; ++i) {
    const j = (i + 1) % count;
    const dLng = (ring[2 * j + 1] - ring[2 * i + 1]) * toRadians;
    sum +=
        dLng * (2 + Math.sin(ring[2 * i] * toRadians) + Math.sin(ring[2 * j] * toRadians));
  }
  return Math.abs(sum) * EARTH_RADIUS_METERS * EARTH_RADIUS_METERS / 2;
}

// 1609.344 m to a mile, so about 2.59 km² to a square mile
const METERS2_PER_MILE2 = 1609.344 * 1609.344;
// 640 acres to a square mile
const METERS2_PER_ACRE = METERS2_PER_MILE2 / 640;

/**
 * Formats an area in square miles or kilometers, or in acres or square meters below one of those so
 * that a campsite doesn't read as zero.
 */
export function formatArea(meters2: number, system: UnitSystem = getUnitSystem()): string {
  const imperial = system === 'imperial';
  const [large, small] =
      imperial
          ? [{per: METERS2_PER_MILE2, unit: 'mi²'}, {per: METERS2_PER_ACRE, unit: 'ac'}]
          : [{per: 1_000_000, unit: 'km²'}, {per: 1, unit: 'm²'}];
  if (meters2 >= large.per) {
    const value =
        new Intl.NumberFormat(undefined, {maximumFractionDigits: 1}).format(meters2 / large.per);
    return `${value} ${large.unit}`;
  }
  const value =
      new Intl.NumberFormat(undefined, {maximumSignificantDigits: 2}).format(meters2 / small.per);
  return `${value} ${small.unit}`;
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

/** Sums climb and descent between samples, the way measureLine does between vertices. */
export function profileStats(meters: ArrayLike<number>): ProfileStats {
  const climb = new ClimbCounter();
  for (let i = 0; i < meters.length; ++i) {
    climb.add(meters[i]);
  }
  const sorted = Array.from(meters).sort((a, b) => a - b);
  return {
    upMeters: climb.upMeters,
    downMeters: climb.downMeters,
    minMeters: sorted[0] ?? 0,
    medianMeters: sorted[Math.floor(sorted.length / 2)] ?? 0,
    maxMeters: sorted[sorted.length - 1] ?? 0,
  };
}

// Follows the running peak or valley and only turns around once the elevation has come back
// CLIMB_THRESHOLD_METERS from it, so a peak counts in full and a wobble counts not at all.
// Keep in sync with CalculateWayElevations#ClimbCounter.
class ClimbCounter {
  upMeters = 0;
  downMeters = 0;
  // The running peak or valley, or the first elevation until the line has moved far enough to
  // have a direction
  private extreme = NaN;
  private rising: boolean|undefined = undefined;

  // Returns the climb or descent this elevation counted
  add(meters: number): number {
    if (Number.isNaN(this.extreme)) {
      this.extreme = meters;
      return 0;
    } else if (
        meters > this.extreme
            && (this.rising === true || meters - this.extreme >= CLIMB_THRESHOLD_METERS)) {
      const rise = meters - this.extreme;
      this.upMeters += rise;
      this.extreme = meters;
      this.rising = true;
      return rise;
    } else if (
        meters < this.extreme
            && (this.rising === false || this.extreme - meters >= CLIMB_THRESHOLD_METERS)) {
      const fall = this.extreme - meters;
      this.downMeters += fall;
      this.extreme = meters;
      this.rising = false;
      return fall;
    } else {
      return 0;
    }
  }
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
