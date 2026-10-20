import { getApparentAltitude, getSunlight } from './sunlight';

const DEGREES = Math.PI / 180;

test('Level ground is lit evenly by how high the sun is', () => {
  const heights = new Float32Array(20 * 20);
  const darkness = getSunlight(heights, 20, 20, 10, 90 * DEGREES, 30 * DEGREES);
  for (const value of darkness) {
    expect(value).toBeCloseTo(1 - Math.sin(30 * DEGREES), 2);
  }
});

test('A wall casts a shadow away from the sun as long as its height over the sun slope', () => {
  // 100 pixels of 10 m east to west, with a 50 m wall at x = 80 and the sun low in the east
  const width = 100;
  const heights = new Float32Array(width * 3);
  for (let y = 0; y < 3; ++y) {
    heights[y * width + 80] = 50;
  }
  const darkness = getSunlight(heights, width, 3, 10, 90 * DEGREES, 10 * DEGREES);
  // 50 m / tan(10 degrees) is 284 m, so about 28 pixels west of the wall
  const row = Array.from(darkness.subarray(width, 2 * width));
  expect(row[79]).toBe(1);
  expect(row[60]).toBe(1);
  expect(row[53]).toBe(1);
  expect(row[48]).toBeLessThan(1);
  // East of the wall is in the sun.
  expect(row[90]).toBeLessThan(1);
});

test('Nothing is lit with the sun down', () => {
  const darkness = getSunlight(new Float32Array(4), 2, 2, 10, 0, -1 * DEGREES);
  expect(Array.from(darkness)).toEqual([1, 1, 1, 1]);
});

test('Refraction lifts the sun most at the horizon', () => {
  expect((getApparentAltitude(0) - 0) / DEGREES).toBeCloseTo(0.48, 1);
  expect((getApparentAltitude(45 * DEGREES) - 45 * DEGREES) / DEGREES).toBeLessThan(0.02);
});
