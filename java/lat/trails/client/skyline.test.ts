import { SKYLINE_AZIMUTHS } from 'js/map/workers/terrain_tracer';

import { getBearing, getSkylineAt } from './skyline';

const DEGREES = Math.PI / 180;

test('Bearings run clockwise from north', () => {
  expect(getBearing(45, 7, 46, 7) / DEGREES).toBeCloseTo(0, 6);
  expect(getBearing(45, 7, 45, 8) / DEGREES).toBeCloseTo(89.6, 1);
  expect(getBearing(45, 7, 44, 7) / DEGREES).toBeCloseTo(180, 6);
});

test('The skyline blends the two directions beside an azimuth', () => {
  const skyline = new Float32Array(SKYLINE_AZIMUTHS);
  // Due east is a quarter of the way around.
  skyline[SKYLINE_AZIMUTHS / 4] = 10 * DEGREES;
  const step = 360 / SKYLINE_AZIMUTHS;
  expect(getSkylineAt(skyline, 90 * DEGREES) / DEGREES).toBeCloseTo(10, 4);
  expect(getSkylineAt(skyline, (90 + step / 2) * DEGREES) / DEGREES).toBeCloseTo(5, 4);
  expect(getSkylineAt(skyline, 0)).toBe(0);
});
