import { WorldBoundsQuadtree } from './bounds_quadtree';
import { Rect } from './types';

test('finds intersecting bound', () => {
  const qt = new WorldBoundsQuadtree<string>();
  qt.insert('a bound', {
    low: [-0.676188353888889, 0.29574154468566277],
    high: [-0.6759365516666668, 0.29587655213844616],
  } as Rect);

  const results: string[] = [];
  const query =
      qt.queryCircle([-0.6761819853825033, 0.2957417081612863], 1.76943513605359e-7, results);
  expect(results.length).toBe(1);
});

test('finds a bound the circle only reaches from outside', () => {
  const qt = new WorldBoundsQuadtree<string>();
  qt.insert('a bound', {low: [0.1, 0.1], high: [0.3, 0.2]} as Rect);

  const results: string[] = [];
  qt.queryCircle([0.2, 0.21], 0.02, results);
  expect(results).toEqual(['a bound']);
});

test('misses a bound the circle stops short of', () => {
  const qt = new WorldBoundsQuadtree<string>();
  qt.insert('a bound', {low: [0.1, 0.1], high: [0.3, 0.2]} as Rect);

  const results: string[] = [];
  qt.queryCircle([0.2, 0.23], 0.02, results);
  expect(results).toEqual([]);
});

test('collapses after deleting below the split threshold', () => {
  const qt = new WorldBoundsQuadtree<number>();
  const bounds: Rect[] = [];
  for (let i = 0; i < 150; ++i) {
    const x = 0.1 + i * 0.005;
    const bound = {low: [x, 0.5], high: [x + 0.001, 0.501]} as Rect;
    bounds.push(bound);
    qt.insert(i, bound);
  }
  const root = (qt as any).root;
  expect(root.children).toBeDefined();
  expect(root.valueCount).toBe(150);

  for (let i = 0; i < 100; ++i) {
    expect(qt.delete(bounds[i])).toBe(true);
  }
  expect(root.valueCount).toBe(50);
  expect(root.children).toBeUndefined();

  const results: number[] = [];
  qt.queryRect({low: [0, 0], high: [1, 1]} as Rect, results);
  expect(results.sort((a, b) => a - b)).toEqual([...Array(50).keys()].map(i => i + 100));
});
