import { EditableLine } from './features';

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
