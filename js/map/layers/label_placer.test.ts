import { CollisionGrid } from './label_placer';

test('finds boxes across cells', () => {
  const grid = new CollisionGrid();
  grid.reset(-200, -200, 200, 200);
  grid.insert(-100, -10, 100, 10);

  expect(grid.hits(90, 5, 120, 30)).toBe(true);
  expect(grid.hits(-150, -5, -110, 5)).toBe(false);
  expect(grid.hits(-5, 11, 5, 20)).toBe(false);
});

test('clamps boxes past the edges into the edge cells', () => {
  const grid = new CollisionGrid();
  grid.reset(-100, -100, 100, 100);
  grid.insert(150, 150, 170, 170);

  expect(grid.hits(160, 160, 165, 165)).toBe(true);
  expect(grid.hits(120, 120, 140, 140)).toBe(false);
});

test('forgets boxes on reset', () => {
  const grid = new CollisionGrid();
  grid.reset(-100, -100, 100, 100);
  grid.insert(-10, -10, 10, 10);
  grid.reset(-100, -100, 100, 100);

  expect(grid.hits(-10, -10, 10, 10)).toBe(false);
});
