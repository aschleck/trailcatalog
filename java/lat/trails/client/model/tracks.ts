import { EditableLine } from './features';

export interface TrackPosition {
  latE7: number;
  lngE7: number;
  elevationCentimeters: number|undefined;
}

/**
 * Returns where the first track whose times span the given moment was at that moment, interpolated
 * between the two points around it.
 */
export function getPositionAt(
    lines: Iterable<EditableLine>, seconds: number): TrackPosition|undefined {
  const at = BigInt(Math.round(seconds));
  for (const line of lines) {
    const times = line.timeSeconds;
    if (times === undefined || times.length < 2) {
      continue;
    }
    let lo = 0;
    let hi = times.length - 1;
    if (at < times[lo] || at > times[hi]) {
      continue;
    }

    // We keep times[lo] <= at <= times[hi], which narrows to a neighboring pair even when a GPS
    // glitch leaves the times out of order.
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (times[mid] <= at) {
        lo = mid;
      } else {
        hi = mid;
      }
    }

    const span = Number(times[hi] - times[lo]);
    const f = span > 0 ? Number(at - times[lo]) / span : 0;
    const lerp = (a: number, b: number) => Math.round(a + (b - a) * f);
    const elevations = line.elevationCentimeters;
    return {
      latE7: lerp(line.latLngE7[2 * lo], line.latLngE7[2 * hi]),
      lngE7: lerp(line.latLngE7[2 * lo + 1], line.latLngE7[2 * hi + 1]),
      elevationCentimeters: elevations ? lerp(elevations[lo], elevations[hi]) : undefined,
    };
  }
  return undefined;
}
