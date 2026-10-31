import { EditableLine, EditableShape } from './features';
import { haversineMeters } from './measurements';

// Each returns a new line with new arrays, because undo holds on to the old ones. Moving,
// inserting, removing vertices, and reversing also take a polygon, whose ring's last vertex joins
// back to its first, so inserting at the vertex count lands on that closing segment.

/**
 * Moves one vertex, keeping its time and, until the caller reads the DEM for the new spot, its
 * elevation.
 */
export function moveVertex<T extends EditableShape>(
    shape: T, index: number, latE7: number, lngE7: number): T {
  const latLngE7 = shape.latLngE7.slice();
  latLngE7[2 * index] = latE7;
  latLngE7[2 * index + 1] = lngE7;
  return {
    ...shape,
    data: {...shape.data},
    latLngE7,
    ...(shape.kind === 'line' && {
      elevationCentimeters: shape.elevationCentimeters?.slice(),
      timeSeconds: shape.timeSeconds?.slice(),
    }),
  };
}

/**
 * Inserts a vertex so that it lands at index, interpolating its time from its neighbors and, until
 * the caller reads the DEM for it, its elevation.
 */
export function insertVertex<T extends EditableShape>(
    shape: T, index: number, latE7: number, lngE7: number): T {
  const count = shape.latLngE7.length / 2;
  const latLngE7 = new Int32Array(2 * (count + 1));
  latLngE7.set(shape.latLngE7.subarray(0, 2 * index), 0);
  latLngE7[2 * index] = latE7;
  latLngE7[2 * index + 1] = lngE7;
  latLngE7.set(shape.latLngE7.subarray(2 * index), 2 * index + 2);
  const inserted = {...shape, data: {...shape.data}, latLngE7};
  if (shape.kind === 'polygon') {
    return inserted;
  }

  const before = Math.max(0, index - 1);
  const after = Math.min(count - 1, index);
  let elevationCentimeters = undefined;
  if (shape.elevationCentimeters) {
    const source = shape.elevationCentimeters;
    elevationCentimeters = new Int32Array(count + 1);
    elevationCentimeters.set(source.subarray(0, index), 0);
    elevationCentimeters[index] = Math.round((source[before] + source[after]) / 2);
    elevationCentimeters.set(source.subarray(index), index + 1);
  }
  let timeSeconds = undefined;
  if (shape.timeSeconds) {
    const source = shape.timeSeconds;
    timeSeconds = new BigInt64Array(count + 1);
    timeSeconds.set(source.subarray(0, index), 0);
    timeSeconds[index] = (source[before] + source[after]) / 2n;
    timeSeconds.set(source.subarray(index), index + 1);
  }

  return {...inserted, elevationCentimeters, timeSeconds};
}

/** Returns the fewest vertices a line or a polygon can have. */
export function minVertexCount(shape: EditableShape): number {
  return shape.kind === 'polygon' ? 3 : 2;
}

/** Removes one vertex, or returns undefined when that would leave fewer than minVertexCount. */
export function removeVertex<T extends EditableShape>(shape: T, index: number): T|undefined {
  const count = shape.latLngE7.length / 2;
  if (count <= minVertexCount(shape)) {
    return undefined;
  }

  const latLngE7 = new Int32Array(2 * (count - 1));
  latLngE7.set(shape.latLngE7.subarray(0, 2 * index), 0);
  latLngE7.set(shape.latLngE7.subarray(2 * index + 2), 2 * index);
  return {
    ...shape,
    data: {...shape.data},
    latLngE7,
    ...(shape.kind === 'line' && {
      elevationCentimeters: shape.elevationCentimeters && without(shape.elevationCentimeters, index),
      timeSeconds: shape.timeSeconds && without(shape.timeSeconds, index),
    }),
  };
}

/**
 * Turns a drawn path into a polygon's ring, dropping repeated vertices where routed pieces meet and
 * any last vertex that repeats the first. Returns undefined when fewer than three distinct vertices
 * remain.
 */
export function toRing(latLngE7: Int32Array): Int32Array|undefined {
  const kept = withoutRepeats(latLngE7);
  let end = kept.length;
  while (end > 2 && kept[end - 2] === kept[0] && kept[end - 1] === kept[1]) {
    end -= 2;
  }
  return end >= 6 ? kept.slice(0, end) : undefined;
}

// Drops each vertex that repeats the one before, like where routed pieces meet or where rounding
// to E7 merged neighbors.
export function withoutRepeats(latLngE7: Int32Array): Int32Array {
  const kept = [];
  for (let i = 0; i < latLngE7.length; i += 2) {
    if (i === 0 || latLngE7[i] !== latLngE7[i - 2] || latLngE7[i + 1] !== latLngE7[i - 1]) {
      kept.push(latLngE7[i], latLngE7[i + 1]);
    }
  }
  return Int32Array.from(kept);
}

function without<T extends Int32Array|BigInt64Array>(array: T, index: number): T {
  const result = new (array.constructor as {new(length: number): T})(array.length - 1);
  result.set(array.subarray(0, index) as any, 0);
  result.set(array.subarray(index + 1) as any, index);
  return result;
}

/**
 * Splits a line at one of its vertices, which both halves keep. The first half keeps the line's
 * id and the second takes secondId. The halves' titles, in the field titleField names, get "1"
 * and "2" after them. Returns undefined for an end, which would leave a half with a single
 * vertex.
 */
export function splitLine(
    line: EditableLine, index: number, secondId: string, titleField: string|undefined):
    [EditableLine, EditableLine]|undefined {
  const count = line.latLngE7.length / 2;
  if (index <= 0 || index >= count - 1) {
    return undefined;
  }

  const title = titleField !== undefined ? line.data[titleField] : undefined;
  const half = (start: number, end: number, id: string, suffix: string): EditableLine => ({
    ...line,
    id,
    version: id === line.id ? line.version : 0n,
    data:
        typeof title === 'string' && title && titleField !== undefined
            ? {...line.data, [titleField]: `${title} ${suffix}`}
            : {...line.data},
    latLngE7: line.latLngE7.slice(2 * start, 2 * end),
    elevationCentimeters: line.elevationCentimeters?.slice(start, end),
    timeSeconds: line.timeSeconds?.slice(start, end),
  });
  return [half(0, index + 1, line.id, '(1)'), half(index, count, secondId, '(2)')];
}

/** Reverses a line's or a ring's direction. Each vertex keeps its own elevation and time. */
export function reverseLine<T extends EditableShape>(shape: T): T {
  const count = shape.latLngE7.length / 2;
  const latLngE7 = new Int32Array(shape.latLngE7.length);
  for (let i = 0; i < count; ++i) {
    latLngE7[2 * i] = shape.latLngE7[2 * (count - 1 - i)];
    latLngE7[2 * i + 1] = shape.latLngE7[2 * (count - 1 - i) + 1];
  }
  return {
    ...shape,
    data: {...shape.data},
    latLngE7,
    ...(shape.kind === 'line' && {
      elevationCentimeters: shape.elevationCentimeters?.slice().reverse(),
      timeSeconds: shape.timeSeconds?.slice().reverse(),
    }),
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

/**
 * Replaces a line's geometry with a new route, dropping repeated vertices where routed pieces meet
 * and where rounding to E7 merged neighbors. Returns undefined when fewer than two distinct
 * vertices remain. Samples belong to the old vertices, so the line loses them.
 */
export function rerouteLine(line: EditableLine, latLngE7: Int32Array): EditableLine|undefined {
  const kept = withoutRepeats(latLngE7);
  if (kept.length < 4) {
    return undefined;
  }

  return {
    ...line,
    data: {...line.data},
    latLngE7: kept,
    elevationCentimeters: undefined,
    timeSeconds: undefined,
  };
}
