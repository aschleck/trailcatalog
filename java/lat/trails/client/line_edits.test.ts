import { EditableLine } from './features';
import {
  insertVertex,
  joinLines,
  moveVertex,
  removeVertex,
  rerouteLine,
  reverseLine,
  splitLine,
} from './line_edits';

test('moves a vertex without touching the original', () => {
  const original = line();
  const moved = moveVertex(original, 1, 50, 60);

  expect(Array.from(moved.latLngE7)).toEqual([0, 0, 50, 60, 20, 20]);
  expect(Array.from(original.latLngE7)).toEqual([0, 0, 10, 10, 20, 20]);
  expect(moved.elevationCentimeters).not.toBe(original.elevationCentimeters);
});

test('inserts a vertex with interpolated samples', () => {
  const inserted = insertVertex(line(), 1, 5, 5);

  expect(Array.from(inserted.latLngE7)).toEqual([0, 0, 5, 5, 10, 10, 20, 20]);
  expect(Array.from(inserted.elevationCentimeters!)).toEqual([100, 150, 200, 300]);
  expect(Array.from(inserted.timeSeconds!)).toEqual([0n, 5n, 10n, 20n]);
});

test('inserts at either end by copying the end sample', () => {
  expect(Array.from(insertVertex(line(), 0, -1, -1).elevationCentimeters!))
      .toEqual([100, 100, 200, 300]);
  expect(Array.from(insertVertex(line(), 3, 30, 30).elevationCentimeters!))
      .toEqual([100, 200, 300, 300]);
});

test('reroutes without repeated vertices or samples', () => {
  const rerouted = rerouteLine(line(), Int32Array.from([0, 0, 0, 0, 5, 5, 5, 5, 20, 20]))!;

  expect(Array.from(rerouted.latLngE7)).toEqual([0, 0, 5, 5, 20, 20]);
  expect(rerouted.elevationCentimeters).toBeUndefined();
  expect(rerouted.timeSeconds).toBeUndefined();
});

test('refuses a reroute that collapses to one vertex', () => {
  expect(rerouteLine(line(), Int32Array.from([3, 3, 3, 3]))).toBeUndefined();
});

test('removes a vertex and its samples', () => {
  const removed = removeVertex(line(), 1)!;

  expect(Array.from(removed.latLngE7)).toEqual([0, 0, 20, 20]);
  expect(Array.from(removed.elevationCentimeters!)).toEqual([100, 300]);
  expect(Array.from(removed.timeSeconds!)).toEqual([0n, 20n]);
});

test('refuses to leave fewer than two vertices', () => {
  expect(removeVertex(removeVertex(line(), 0)!, 0)).toBeUndefined();
});

test('splits at a vertex that both halves keep', () => {
  const [first, second] = splitLine(line(), 1, 'b', 'name')!;

  expect(first.id).toBe('a');
  expect(first.version).toBe(3n);
  expect(first.data.name).toBe('a (1)');
  expect(Array.from(first.latLngE7)).toEqual([0, 0, 10, 10]);
  expect(Array.from(first.elevationCentimeters!)).toEqual([100, 200]);
  expect(Array.from(first.timeSeconds!)).toEqual([0n, 10n]);
  expect(second.id).toBe('b');
  expect(second.version).toBe(0n);
  expect(second.data.name).toBe('a (2)');
  expect(Array.from(second.latLngE7)).toEqual([10, 10, 20, 20]);
  expect(Array.from(second.elevationCentimeters!)).toEqual([200, 300]);
  expect(Array.from(second.timeSeconds!)).toEqual([10n, 20n]);
});

test('refuses to split at an end', () => {
  expect(splitLine(line(), 0, 'b', 'name')).toBeUndefined();
  expect(splitLine(line(), 2, 'b', 'name')).toBeUndefined();
});

test('leaves an unnamed line unnamed when splitting', () => {
  const [first, second] = splitLine({...line(), data: {}}, 1, 'b', 'name')!;

  expect(first.data.name).toBeUndefined();
  expect(second.data.name).toBeUndefined();
});

test('reverses a line with its samples', () => {
  const original = line();
  const reversed = reverseLine(original);

  expect(Array.from(reversed.latLngE7)).toEqual([20, 20, 10, 10, 0, 0]);
  expect(Array.from(reversed.elevationCentimeters!)).toEqual([300, 200, 100]);
  expect(Array.from(reversed.timeSeconds!)).toEqual([20n, 10n, 0n]);
  expect(Array.from(original.latLngE7)).toEqual([0, 0, 10, 10, 20, 20]);
});

test('joins the halves of a split back together', () => {
  const [first, second] = splitLine(line(), 1, 'b', 'name')!;
  const joined = joinLines({...first, data: {name: 'a'}}, second);

  expect(joined.id).toBe('a');
  expect(joined.data.name).toBe('a');
  expect(Array.from(joined.latLngE7)).toEqual([0, 0, 10, 10, 20, 20]);
  expect(Array.from(joined.elevationCentimeters!)).toEqual([100, 200, 300]);
  expect(Array.from(joined.timeSeconds!)).toEqual([0n, 10n, 20n]);
});

test('turns the second line around to meet at the nearest ends', () => {
  const a = {...line(), elevationCentimeters: undefined, timeSeconds: undefined};
  const b = {...a, id: 'b', latLngE7: Int32Array.from([50, 50, 30, 30])};
  expect(Array.from(joinLines(a, b).latLngE7)).toEqual([0, 0, 10, 10, 20, 20, 30, 30, 50, 50]);

  const before = {...a, id: 'b', latLngE7: Int32Array.from([-30, -30, -10, -10])};
  expect(Array.from(joinLines(a, before).latLngE7))
      .toEqual([-30, -30, -10, -10, 0, 0, 10, 10, 20, 20]);
});

test('turns the second line around to meet at both starts', () => {
  const a = {...line(), elevationCentimeters: undefined, timeSeconds: undefined};
  const b = {...a, id: 'b', latLngE7: Int32Array.from([-10, -10, -30, -30])};

  expect(Array.from(joinLines(a, b).latLngE7))
      .toEqual([-30, -30, -10, -10, 0, 0, 10, 10, 20, 20]);
});

test('splits partway along a segment into halves that share only the new vertex', () => {
  const [first, second] = splitLine(insertVertex(line(), 2, 15, 15), 2, 'b', 'name')!;

  expect(Array.from(first.latLngE7)).toEqual([0, 0, 10, 10, 15, 15]);
  expect(Array.from(second.latLngE7)).toEqual([15, 15, 20, 20]);
  expect(Array.from(joinLines(first, second).latLngE7)).toEqual([0, 0, 10, 10, 15, 15, 20, 20]);
});

test('drops samples that only one line has', () => {
  const b = {...line(), id: 'b', latLngE7: Int32Array.from([20, 20, 30, 30])};
  const joined = joinLines(line(), {...b, elevationCentimeters: undefined, timeSeconds: undefined});

  expect(Array.from(joined.latLngE7)).toEqual([0, 0, 10, 10, 20, 20, 30, 30]);
  expect(joined.elevationCentimeters).toBeUndefined();
  expect(joined.timeSeconds).toBeUndefined();
});

function line(): EditableLine {
  return {
    kind: 'line',
    id: 'a',
    version: 3n,
    data: {name: 'a'},
    latLngE7: Int32Array.from([0, 0, 10, 10, 20, 20]),
    elevationCentimeters: Int32Array.from([100, 200, 300]),
    timeSeconds: BigInt64Array.from([0n, 10n, 20n]),
  };
}
