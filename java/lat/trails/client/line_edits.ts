import { EditableLine } from './features';
import { haversineMeters } from './measurements';

// Each returns a new line with new arrays, because undo holds on to the old ones.

/** Moves one vertex. Its elevation and time stay, since neither is known for the new spot. */
export function moveVertex(
    line: EditableLine, index: number, latE7: number, lngE7: number): EditableLine {
  const latLngE7 = line.latLngE7.slice();
  latLngE7[2 * index] = latE7;
  latLngE7[2 * index + 1] = lngE7;
  return {
    ...line,
    data: {...line.data},
    latLngE7,
    elevationCentimeters: line.elevationCentimeters?.slice(),
    timeSeconds: line.timeSeconds?.slice(),
  };
}

/**
 * Inserts a vertex so that it lands at index, interpolating its elevation and time from its
 * neighbors.
 */
export function insertVertex(
    line: EditableLine, index: number, latE7: number, lngE7: number): EditableLine {
  const count = line.latLngE7.length / 2;
  const latLngE7 = new Int32Array(2 * (count + 1));
  latLngE7.set(line.latLngE7.subarray(0, 2 * index), 0);
  latLngE7[2 * index] = latE7;
  latLngE7[2 * index + 1] = lngE7;
  latLngE7.set(line.latLngE7.subarray(2 * index), 2 * index + 2);

  const before = Math.max(0, index - 1);
  const after = Math.min(count - 1, index);
  let elevationCentimeters = undefined;
  if (line.elevationCentimeters) {
    const source = line.elevationCentimeters;
    elevationCentimeters = new Int32Array(count + 1);
    elevationCentimeters.set(source.subarray(0, index), 0);
    elevationCentimeters[index] = Math.round((source[before] + source[after]) / 2);
    elevationCentimeters.set(source.subarray(index), index + 1);
  }
  let timeSeconds = undefined;
  if (line.timeSeconds) {
    const source = line.timeSeconds;
    timeSeconds = new BigInt64Array(count + 1);
    timeSeconds.set(source.subarray(0, index), 0);
    timeSeconds[index] = (source[before] + source[after]) / 2n;
    timeSeconds.set(source.subarray(index), index + 1);
  }

  return {...line, data: {...line.data}, latLngE7, elevationCentimeters, timeSeconds};
}

/** Removes one vertex, or returns undefined when that would leave fewer than two. */
export function removeVertex(line: EditableLine, index: number): EditableLine|undefined {
  const count = line.latLngE7.length / 2;
  if (count <= 2) {
    return undefined;
  }

  const latLngE7 = new Int32Array(2 * (count - 1));
  latLngE7.set(line.latLngE7.subarray(0, 2 * index), 0);
  latLngE7.set(line.latLngE7.subarray(2 * index + 2), 2 * index);
  return {
    ...line,
    data: {...line.data},
    latLngE7,
    elevationCentimeters: line.elevationCentimeters && without(line.elevationCentimeters, index),
    timeSeconds: line.timeSeconds && without(line.timeSeconds, index),
  };
}

function without<T extends Int32Array|BigInt64Array>(array: T, index: number): T {
  const result = new (array.constructor as {new(length: number): T})(array.length - 1);
  result.set(array.subarray(0, index) as any, 0);
  result.set(array.subarray(index + 1) as any, index);
  return result;
}

/**
 * Splits a line at one of its vertices, which both halves keep. The first half keeps the line's
 * id and the second takes secondId. Returns undefined for an end, which would leave a half with a
 * single vertex.
 */
export function splitLine(line: EditableLine, index: number, secondId: string):
    [EditableLine, EditableLine]|undefined {
  const count = line.latLngE7.length / 2;
  if (index <= 0 || index >= count - 1) {
    return undefined;
  }

  const name = line.data.name;
  const half = (start: number, end: number, id: string, suffix: string): EditableLine => ({
    ...line,
    id,
    version: id === line.id ? line.version : 0n,
    data: name ? {...line.data, name: `${name} ${suffix}`} : {...line.data},
    latLngE7: line.latLngE7.slice(2 * start, 2 * end),
    elevationCentimeters: line.elevationCentimeters?.slice(start, end),
    timeSeconds: line.timeSeconds?.slice(start, end),
  });
  return [half(0, index + 1, line.id, '(1)'), half(index, count, secondId, '(2)')];
}

/** Reverses a line's direction. Each vertex keeps its own elevation and time. */
export function reverseLine(line: EditableLine): EditableLine {
  const count = line.latLngE7.length / 2;
  const latLngE7 = new Int32Array(line.latLngE7.length);
  for (let i = 0; i < count; ++i) {
    latLngE7[2 * i] = line.latLngE7[2 * (count - 1 - i)];
    latLngE7[2 * i + 1] = line.latLngE7[2 * (count - 1 - i) + 1];
  }
  return {
    ...line,
    data: {...line.data},
    latLngE7,
    elevationCentimeters: line.elevationCentimeters?.slice().reverse(),
    timeSeconds: line.timeSeconds?.slice().reverse(),
  };
}

/**
 * Joins two lines at whichever of their ends are nearest, turning b around if it runs the other
 * way. The result keeps a's id and data. Ends in the same spot become one vertex, and anything
 * else is bridged by a straight segment.
 */
export function joinLines(a: EditableLine, b: EditableLine): EditableLine {
  const aLast = a.latLngE7.length / 2 - 1;
  const bLast = b.latLngE7.length / 2 - 1;
  const gap = (i: number, j: number) =>
      haversineMeters(
          a.latLngE7[2 * i] / 1e7,
          a.latLngE7[2 * i + 1] / 1e7,
          b.latLngE7[2 * j] / 1e7,
          b.latLngE7[2 * j + 1] / 1e7);
  // a's end or start, against b's start or end
  const options = [
    {first: a, second: b, gap: gap(aLast, 0)},
    {first: a, second: reverseLine(b), gap: gap(aLast, bLast)},
    {first: b, second: a, gap: gap(0, bLast)},
    {first: reverseLine(b), second: a, gap: gap(0, 0)},
  ];
  const {first, second} = options.reduce((best, option) => option.gap < best.gap ? option : best);

  const firstCount = first.latLngE7.length / 2;
  const shared =
      first.latLngE7[2 * firstCount - 2] === second.latLngE7[0]
          && first.latLngE7[2 * firstCount - 1] === second.latLngE7[1];
  const skip = shared ? 1 : 0;
  const latLngE7 = new Int32Array(first.latLngE7.length + second.latLngE7.length - 2 * skip);
  latLngE7.set(first.latLngE7, 0);
  latLngE7.set(second.latLngE7.subarray(2 * skip), first.latLngE7.length);

  // Samples only survive when both lines have them, or else they would not line up with the
  // vertices.
  let elevationCentimeters = undefined;
  if (first.elevationCentimeters && second.elevationCentimeters) {
    elevationCentimeters = new Int32Array(latLngE7.length / 2);
    elevationCentimeters.set(first.elevationCentimeters, 0);
    elevationCentimeters.set(second.elevationCentimeters.subarray(skip), firstCount);
  }
  let timeSeconds = undefined;
  if (first.timeSeconds && second.timeSeconds) {
    timeSeconds = new BigInt64Array(latLngE7.length / 2);
    timeSeconds.set(first.timeSeconds, 0);
    timeSeconds.set(second.timeSeconds.subarray(skip), firstCount);
  }

  return {...a, data: {...a.data}, latLngE7, elevationCentimeters, timeSeconds};
}
