import { EditableLine } from './features';
import { insertVertex, moveVertex, removeVertex, reverseLine, splitLine } from './line_edits';

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
  const [first, second] = splitLine(line(), 1, 'b')!;

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
  expect(splitLine(line(), 0, 'b')).toBeUndefined();
  expect(splitLine(line(), 2, 'b')).toBeUndefined();
});

test('leaves an unnamed line unnamed when splitting', () => {
  const [first, second] = splitLine({...line(), data: {}}, 1, 'b')!;

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
