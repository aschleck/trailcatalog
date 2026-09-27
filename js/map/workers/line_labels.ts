/** Where along a line a label may sit, and how strongly placement should prefer it. */
export interface LineAnchor {
  // arc length from the start of the line
  at: number;
  rank: number;
}

// The rank of the anchor in the middle of a line, above any that trailing zeros can reach.
const MIDDLE_RANK = 32;

/**
 * Joins polylines that share an endpoint into longer ones. A tile crop and the way splits in the
 * source data both cut one named road into pieces, and a name should follow the whole road.
 */
export function mergeLines(parts: number[][]): number[][] {
  // Every endpoint of an unmerged part, keyed by its coordinates.
  const ends = new Map<string, number[][]>();
  const endKey = (line: number[], head: boolean) =>
      head ? `${line[0]},${line[1]}` : `${line[line.length - 2]},${line[line.length - 1]}`;
  const remove = (key: string, line: number[]) => {
    const lines = ends.get(key);
    if (!lines) {
      return;
    }
    const i = lines.indexOf(line);
    if (i >= 0) {
      lines.splice(i, 1);
    }
    if (lines.length === 0) {
      ends.delete(key);
    }
  };

  const open = new Set<number[]>();
  for (const part of parts) {
    if (part.length < 4) {
      continue;
    }
    open.add(part);
    for (const head of [true, false]) {
      const key = endKey(part, head);
      const lines = ends.get(key);
      if (lines) {
        lines.push(part);
      } else {
        ends.set(key, [part]);
      }
    }
  }

  const merged: number[][] = [];
  for (const start of open) {
    open.delete(start);
    remove(endKey(start, true), start);
    remove(endKey(start, false), start);
    let line = start;

    // Grow the tail, then reverse and grow what was the head.
    for (let pass = 0; pass < 2; ++pass) {
      for (;;) {
        const key = endKey(line, false);
        const next = ends.get(key)?.[0];
        if (!next) {
          break;
        }
        open.delete(next);
        remove(endKey(next, true), next);
        remove(endKey(next, false), next);
        const forward = endKey(next, true) === key;
        const oriented = forward ? next : reverse(next);
        line = line.concat(oriented.slice(2));
      }
      line = reverse(line);
    }
    merged.push(line);
  }
  return merged;
}

function reverse(line: number[]): number[] {
  const reversed = new Array<number>(line.length);
  for (let i = 0; i < line.length; i += 2) {
    reversed[line.length - 2 - i] = line[i];
    reversed[line.length - 1 - i] = line[i + 1];
  }
  return reversed;
}

/**
 * Spaces anchors along a line so that dropping every anchor below a rank leaves the rest evenly
 * spaced. The middle anchor ranks highest, then every anchor whose index from the middle is a
 * multiple of 2^n ranks n. A placer that walks anchors by rank and refuses repeats closer than
 * some distance then keeps the densest even spacing that fits, whatever the zoom.
 *
 * margin is how much of the line an anchor needs on either side for its text.
 */
export function lineAnchors(length: number, spacing: number, margin: number): LineAnchor[] {
  const middle = length / 2;
  if (middle < margin) {
    return [];
  }

  const anchors = [{at: middle, rank: MIDDLE_RANK}];
  const steps = Math.floor((middle - margin) / spacing);
  for (let k = 1; k <= steps; ++k) {
    const rank = trailingZeros(k);
    anchors.push({at: middle - k * spacing, rank}, {at: middle + k * spacing, rank});
  }
  return anchors;
}

function trailingZeros(k: number): number {
  let zeros = 0;
  while ((k & 1) === 0) {
    k >>= 1;
    zeros += 1;
  }
  return zeros;
}

export function polylineLength(geometry: ArrayLike<number>): number {
  let length = 0;
  for (let i = 0; i + 3 < geometry.length; i += 2) {
    const dx = geometry[i + 2] - geometry[i + 0];
    const dy = geometry[i + 3] - geometry[i + 1];
    length += Math.sqrt(dx * dx + dy * dy);
  }
  return length;
}

/** Returns the x, y, and heading at an arc length along geometry. */
export function sampleAt(geometry: ArrayLike<number>, at: number): [number, number, number] {
  let travelled = 0;
  for (let i = 0; i + 3 < geometry.length; i += 2) {
    const dx = geometry[i + 2] - geometry[i + 0];
    const dy = geometry[i + 3] - geometry[i + 1];
    const length = Math.sqrt(dx * dx + dy * dy);
    if (travelled + length >= at || i + 5 >= geometry.length) {
      const fraction = length > 0 ? (at - travelled) / length : 0;
      return [
        geometry[i + 0] + fraction * dx,
        geometry[i + 1] + fraction * dy,
        Math.atan2(dy, dx),
      ];
    }
    travelled += length;
  }
  return [geometry[0], geometry[1], 0];
}

/** Returns geometry between two arc lengths, cutting the end segments. */
export function clipAround(geometry: ArrayLike<number>, from: number, to: number): number[] {
  const path: number[] = [];
  let travelled = 0;
  for (let i = 0; i + 3 < geometry.length; i += 2) {
    const dx = geometry[i + 2] - geometry[i + 0];
    const dy = geometry[i + 3] - geometry[i + 1];
    const length = Math.sqrt(dx * dx + dy * dy);
    if (length > 0 && travelled + length >= from && travelled <= to) {
      if (path.length === 0) {
        const fraction = Math.max(0, (from - travelled) / length);
        path.push(geometry[i + 0] + fraction * dx, geometry[i + 1] + fraction * dy);
      }

      const fraction = Math.min(1, (to - travelled) / length);
      path.push(geometry[i + 0] + fraction * dx, geometry[i + 1] + fraction * dy);
    }
    travelled += length;
  }
  return path;
}

/** Returns the most that geometry turns within any stretch of it no longer than window. */
export function maxTurnWithin(geometry: ArrayLike<number>, window: number): number {
  // The arc length of each interior vertex and the signed turn from the start through it
  const at: number[] = [];
  const turned: number[] = [];
  let travelled = 0;
  let total = 0;
  let heading: number|undefined;
  for (let i = 0; i + 3 < geometry.length; i += 2) {
    const dx = geometry[i + 2] - geometry[i + 0];
    const dy = geometry[i + 3] - geometry[i + 1];
    const length = Math.sqrt(dx * dx + dy * dy);
    if (length === 0) {
      continue;
    }

    const next = Math.atan2(dy, dx);
    if (heading !== undefined) {
      let turn = next - heading;
      if (turn > Math.PI) {
        turn -= 2 * Math.PI;
      } else if (turn < -Math.PI) {
        turn += 2 * Math.PI;
      }
      total += turn;
      at.push(travelled);
      turned.push(total);
    }
    heading = next;
    travelled += length;
  }

  let max = 0;
  for (let i = 0; i < at.length; ++i) {
    const before = i > 0 ? turned[i - 1] : 0;
    for (let j = i; j < at.length && at[j] - at[i] <= window; ++j) {
      max = Math.max(max, Math.abs(turned[j] - before));
    }
  }
  return max;
}

/**
 * Resamples geometry every step along it and averages each sample with those within radius of it,
 * so text laid along the result follows the line's shape and not the jitter of its vertices.
 * Samples past the ends repeat the endpoints, so the ends pull in a little rather than keeping
 * their jitter.
 */
export function smoothLine(geometry: ArrayLike<number>, step: number, radius: number): number[] {
  const length = polylineLength(geometry);
  const count = Math.max(2, Math.ceil(length / step) + 1);
  const samples: number[] = [];
  for (let i = 0; i < count; ++i) {
    const [x, y] = sampleAt(geometry, length * i / (count - 1));
    samples.push(x, y);
  }

  const reach = Math.round(radius / step);
  const smoothed: number[] = [];
  for (let i = 0; i < count; ++i) {
    let x = 0;
    let y = 0;
    for (let j = i - reach; j <= i + reach; ++j) {
      const clamped = Math.min(count - 1, Math.max(0, j));
      x += samples[2 * clamped + 0];
      y += samples[2 * clamped + 1];
    }
    smoothed.push(x / (2 * reach + 1), y / (2 * reach + 1));
  }
  return smoothed;
}
