import { measureLine, profileSamples, profileStats } from './measurements';

test('measures a line along its hypotenuse with raw climb', () => {
  // Two segments of 0.001 degrees of latitude, about 111 m each
  const stats = measureLine([0, 0, 10000, 0, 20000, 0], [0, 1000, 500]);
  expect(stats.lengthMeters).toBeCloseTo(Math.hypot(111.2, 10) + Math.hypot(111.2, 5), 0);
  expect(stats.elevation).toEqual({upMeters: 10, downMeters: 5, minMeters: 0, maxMeters: 10});
});

test('spaces samples along a path and keeps its vertices', () => {
  // About 111 m north then 111 m east at the equator
  const samples = profileSamples(Float64Array.from([0, 0, 0.001, 0, 0.001, 0.001]));
  const distances = Array.from(samples.distanceMeters);

  expect(distances.length).toBe(1 + 12 + 12);
  expect(distances[12]).toBeCloseTo(111.2, 0);
  expect(Array.from(samples.latLngDegrees.subarray(24, 26))).toEqual([0.001, 0]);
  // 78 km to a pixel at zoom 0 over 10 m spacing
  // => 2^12.9
  expect(samples.zoom).toBe(13);
});

test('spreads samples out and zooms out for a long path', () => {
  // About 111 km
  const samples = profileSamples(Float64Array.from([0, 0, 1, 0]));
  expect(samples.distanceMeters.length).toBe(2001);
  expect(samples.zoom).toBe(12);
});

test('summarizes a profile', () => {
  expect(profileStats([100, 120, 110, 150, 140])).toEqual({
    upMeters: 60,
    downMeters: 20,
    minMeters: 100,
    medianMeters: 120,
    maxMeters: 150,
  });
});
