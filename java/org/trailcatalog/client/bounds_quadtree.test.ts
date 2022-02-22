import { worldBounds } from './bounds_quadtree';
import { PixelRect } from './support';

test('finds intersecting bound', () => {
  expect(2 + 2).toBe(4);

  const qt = worldBounds<string>();
  qt.insert('a bound', {
    low: [-0.676188353888889, 0.29574154468566277],
    high: [-0.6759365516666668, 0.29587655213844616],
  });

  const results: string[] = [];
  const query =
      qt.query([-0.6761819853825033, 0.2957417081612863], 1.76943513605359e-7, results);
  expect(results.length).toBe(1);
});
