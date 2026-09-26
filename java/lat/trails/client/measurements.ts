import { S2LatLng } from 'java/org/trailcatalog/s2';
import { SimpleS2 } from 'java/org/trailcatalog/s2/SimpleS2';

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
  let previous = count > 0 ? S2LatLng.fromE7(latLngE7[0], latLngE7[1]) : undefined;
  for (let i = 0; i < count; ++i) {
    const z = elevationCentimeters ? elevationCentimeters[i] / 100 : 0;
    minMeters = Math.min(minMeters, z);
    maxMeters = Math.max(maxMeters, z);
    if (i === 0) {
      continue;
    }

    const at = S2LatLng.fromE7(latLngE7[2 * i], latLngE7[2 * i + 1]);
    const run = previous!.getDistance(at).radians() * SimpleS2.EARTH_RADIUS_METERS;
    const dz = elevationCentimeters ? z - elevationCentimeters[i - 1] / 100 : 0;
    if (dz >= 0) {
      upMeters += dz;
    } else {
      downMeters -= dz;
    }
    lengthMeters += Math.hypot(run, dz);
    previous = at;
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
  return meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(2)} km`;
}

export function formatHeight(meters: number): string {
  return `${Math.round(meters).toLocaleString()} m`;
}
