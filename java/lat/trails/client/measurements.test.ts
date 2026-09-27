import {
  cumulativeMeters,
  measureLine,
  profileSamples,
  profileStats,
  slopeMeters,
} from './measurements';

test('measures a line along its hypotenuse', () => {
  // Two segments of 0.001 degrees of latitude, about 111 m each
  const stats = measureLine([0, 0, 10000, 0, 20000, 0], [0, 1000, 500]);
  expect(stats.lengthMeters).toBeCloseTo(Math.hypot(111.2, 10) + Math.hypot(111.2, 5), 0);
  expect(stats.elevation).toEqual({upMeters: 10, downMeters: 5, minMeters: 0, maxMeters: 10});
});

test('leaves a wobble below the climb threshold out of the length', () => {
  const stats = measureLine([0, 0, 10000, 0, 20000, 0], [0, 300, 0]);
  expect(stats.lengthMeters).toBeCloseTo(222.4, 0);
});

test('spreads a rise over the ground walked before it counted', () => {
  const along = slopeMeters([0, 100, 200, 300, 400], [0, 3, 0, 20, 20]);
  const sloped = Math.hypot(300, 20);
  expect(along[1]).toBeCloseTo(sloped / 3, 5);
  expect(along[2]).toBeCloseTo(sloped * 2 / 3, 5);
  expect(along[3]).toBeCloseTo(sloped, 5);
  expect(along[4]).toBeCloseTo(sloped + 100, 5);
});

test('keeps a rise between samples at the same place', () => {
  const along = slopeMeters([0, 100, 100], [0, 20, 40]);
  expect(Array.from(along)).toEqual([0, Math.hypot(100, 20), Math.hypot(100, 20) + 20]);
});

test('measures the same length as it accumulates', () => {
  const stats = measureLine([0, 0, 10000, 0, 20000, 0, 30000, 0], [0, 300, 0, 2000]);
  // About 111 m between vertices
  expect(stats.lengthMeters).toBeCloseTo(Math.hypot(333.6, 20), 0);
});

test('accumulates distance to each vertex', () => {
  // About 111 m north then 111 m east at the equator
  const along = cumulativeMeters([0, 0, 0.001, 0, 0.001, 0.001]);
  expect(along[0]).toBe(0);
  expect(along[1]).toBeCloseTo(111.2, 0);
  expect(along[2]).toBeCloseTo(222.4, 0);
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

test('ignores wobbles smaller than the climb threshold', () => {
  expect(profileStats([100, 101, 100, 101, 104, 100, 101])).toMatchObject({
    upMeters: 0,
    downMeters: 0,
  });
});

test('counts a peak in full', () => {
  expect(profileStats([0, 2, 4, 6, 8, 10, 8, 6, 4, 2, 0])).toMatchObject({
    upMeters: 10,
    downMeters: 10,
  });
});

test('reports a noisy descent as the descent alone', () => {
  // A meter of flicker on every other sample over a 20 m drop, like a recording rounded to meters
  const meters = [];
  for (let i = 0; i <= 200; ++i) {
    meters.push(100 - i / 10 + (i % 2));
  }
  const stats = profileStats(meters);
  expect(stats.upMeters).toBe(0);
  expect(stats.downMeters).toBeCloseTo(20, 5);
});
