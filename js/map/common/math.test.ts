import { tilesIntersect } from './math';
import { TileId } from './types';

test('finds intersecting tile', () => {
  const a = {
    x: 39,
    y: 97,
    zoom: 8,
  };
  const b = {
    x: 639,
    y: 1554,
    zoom: 12,
  };
  expect(tilesIntersect(a, b)).toBe(true);
});

test('finds tiles are disjoint', () => {
  const a = {
    x: 39,
    y: 98,
    zoom: 8,
  };
  const b = {
    x: 639,
    y: 1554,
    zoom: 12,
  };
  expect(tilesIntersect(a, b)).toBe(false);
});

