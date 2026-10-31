import { RgbaU32 } from 'js/map/common/types';

import { outlineMarker, pushMarker, streamline } from './marker';

const BLACK = 0x000000FF as RgbaU32;

// A pixel is one unit, so sizes read as pixels.
const PIXEL = 1;

// Points every step pixels along the x axis
function straight(count: number, step: number): number[] {
  const points = [];
  for (let i = 0; i < count; ++i) {
    points.push(i * step, 0);
  }
  return points;
}

test('a complete stroke reaches the pointer and an incomplete one trails it', () => {
  const inputs = straight(20, 2);
  const complete = streamline(inputs, 6, PIXEL, /* complete= */ true);
  const trailing = streamline(inputs, 6, PIXEL, /* complete= */ false);
  expect(complete[complete.length - 2]).toBe(38);
  expect(trailing[trailing.length - 2]).toBeLessThan(38);
});

test('skips points until the stroke is a size from where it started', () => {
  const points = streamline(straight(20, 1), 6, PIXEL, /* complete= */ true);
  expect(points[0]).toBe(0);
  expect(points[2]).toBeGreaterThan(1);
});

test('draws a fast stroke thinner than a slow one', () => {
  const slow = outlineMarker(Float64Array.from(straight(50, 0.5)), 6, PIXEL);
  const fast = outlineMarker(Float64Array.from(straight(50, 4)), 6, PIXEL);
  const middle = (radii: Float64Array) => radii[Math.floor(radii.length / 2)];
  expect(middle(fast.radii)).toBeLessThan(middle(slow.radii));
});

test('keeps radii between no pressure and full pressure', () => {
  const {radii, maxRadius} = outlineMarker(Float64Array.from(straight(50, 2)), 6, PIXEL);
  // At a pressure of 0.5 the stroke is 6 px wide, so its size is 6 / sqrt(2).
  const size = 6 / Math.SQRT2;
  for (const radius of radii) {
    expect(radius).toBeGreaterThanOrEqual(size * Math.sin(Math.PI / 8));
    expect(radius).toBeLessThanOrEqual(size * Math.sin(3 * Math.PI / 8));
  }
  expect(maxRadius).toBe(Math.max(...radii));
});

test('drops the wobble as the pointer lifts but keeps the last point', () => {
  // 17 and 18 are within 3 px of the end at 19
  const {points} = outlineMarker(Float64Array.from(straight(20, 1)), 6, PIXEL);
  expect(points.length / 2).toBe(18);
  expect(points[points.length - 2]).toBe(19);
});

test('scales radii to the zoom they are drawn at', () => {
  const outline = {
    points: Float64Array.from([0, 0, 1, 0, 2, 0]),
    radii: Float64Array.from([0.001, 0.003, 0.005]),
    maxRadius: 0.005,
  };
  const buffer = new ArrayBuffer(1024);
  const result =
      pushMarker(BLACK, BLACK, outline, /* extraPx= */ 2, /* worldRadius= */ 1000, buffer, 0);
  expect(result.instanceCount).toBe(2);
  // radius is the eighth float of each instance, see line_program.ts#push
  const floats = new Float32Array(buffer);
  expect(floats[7]).toBeCloseTo(2 + 2);
  expect(floats[9 + 7]).toBeCloseTo(4 + 2);
});

test('never draws thinner than a pixel', () => {
  const outline = {
    points: Float64Array.from([0, 0, 1, 0]),
    radii: Float64Array.from([1e-6, 1e-6]),
    maxRadius: 1e-6,
  };
  const buffer = new ArrayBuffer(1024);
  pushMarker(BLACK, BLACK, outline, /* extraPx= */ 0, /* worldRadius= */ 1000, buffer, 0);
  expect(new Float32Array(buffer)[7]).toBe(1);
});
