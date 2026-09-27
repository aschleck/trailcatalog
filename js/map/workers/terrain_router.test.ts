import { ElevationGrid, GradeLimits, routeOverTerrain, simplifyCells } from './terrain_router';

const GENTLE: GradeLimits = {climb: 0.2, descent: 0.2};

test('crosses flat ground in a line', () => {
  const g = grid(9, 5, () => 100);
  const cells = routeOverTerrain(g, at(g, 0, 2), at(g, 8, 2), GENTLE);
  expect(Array.from(simplifyCells(cells!, g.width, 0.5))).toEqual([0, 2, 8, 2]);
});

test('goes around a wall through its gap', () => {
  // A cliff down column 4 with a gap at the bottom row
  const g = grid(9, 9, (x, y) => x === 4 && y < 8 ? 1000 : 100);
  const cells = routeOverTerrain(g, at(g, 0, 0), at(g, 8, 0), GENTLE)!;
  expect(Array.from(cells).some(c => c === at(g, 4, 8))).toBe(true);
});

test('switches back up a slope steeper than the limit', () => {
  // A 40% slope rising with y
  const g = grid(41, 11, (x, y) => 4 * y);
  const cells = routeOverTerrain(g, at(g, 20, 0), at(g, 20, 10), GENTLE)!;
  expect(cells).toBeDefined();
  expect(steepestClimb(g, cells)).toBeLessThanOrEqual(GENTLE.climb + 1e-9);
  // Climbing 40 m within 20% takes at least 200 m of ground, twice the straight line.
  expect(groundMeters(g, cells)).toBeGreaterThanOrEqual(200);
});

test('finds a heading across a slope five times steeper than the limit', () => {
  // A 100% slope whose contours run 15 degrees off the grid. Sixteen headings leave none within
  // 20%, and heading atan(1 / 3) climbs at 6%.
  const g = grid(40, 30, (x, y) => 10 * y - 2.7 * x);
  expect(routeOverTerrain(g, at(g, 2, 5), at(g, 29, 14), GENTLE)).toBeDefined();
});

test('climbs straight up a slope within the limit', () => {
  // A 10% slope rising with y
  const g = grid(11, 11, (x, y) => y);
  const cells = routeOverTerrain(g, at(g, 5, 0), at(g, 5, 10), GENTLE)!;
  expect(Array.from(simplifyCells(cells, g.width, 0.5))).toEqual([5, 0, 5, 10]);
});

test('holds climb and descent to their own limits', () => {
  // A 30% slope rising with y, which is too steep to climb straight but fine to descend,
  // and one cell wide so there is no traversing it.
  const g = grid(1, 11, (x, y) => 3 * y);
  const limits = {climb: 0.2, descent: 0.4};
  expect(routeOverTerrain(g, at(g, 0, 0), at(g, 0, 10), limits)).toBeUndefined();
  expect(routeOverTerrain(g, at(g, 0, 10), at(g, 0, 0), limits)).toBeDefined();
});

test('gives up when no way keeps within the limits', () => {
  const g = grid(9, 9, x => x === 4 ? 1000 : 100);
  expect(routeOverTerrain(g, at(g, 0, 4), at(g, 8, 4), GENTLE)).toBeUndefined();
});

test('treats missing data as impassable', () => {
  const g = grid(9, 9, x => x === 4 ? NaN : 100);
  expect(routeOverTerrain(g, at(g, 0, 4), at(g, 8, 4), GENTLE)).toBeUndefined();
});

// 10 m cells
function grid(width: number, height: number, z: (x: number, y: number) => number): ElevationGrid {
  const meters = new Float32Array(width * height);
  for (let y = 0; y < height; ++y) {
    for (let x = 0; x < width; ++x) {
      meters[y * width + x] = z(x, y);
    }
  }
  return {meters, width, height, cellMeters: 10};
}

function at(g: ElevationGrid, x: number, y: number): number {
  return y * g.width + x;
}

function steepestClimb(g: ElevationGrid, cells: Int32Array): number {
  let steepest = 0;
  for (let i = 1; i < cells.length; ++i) {
    const rise = g.meters[cells[i]] - g.meters[cells[i - 1]];
    steepest = Math.max(steepest, rise / runMeters(g, cells[i - 1], cells[i]));
  }
  return steepest;
}

function groundMeters(g: ElevationGrid, cells: Int32Array): number {
  let meters = 0;
  for (let i = 1; i < cells.length; ++i) {
    meters += runMeters(g, cells[i - 1], cells[i]);
  }
  return meters;
}

function runMeters(g: ElevationGrid, a: number, b: number): number {
  const dx = b % g.width - a % g.width;
  const dy = Math.floor(b / g.width) - Math.floor(a / g.width);
  return Math.hypot(dx, dy) * g.cellMeters;
}
