import { getMoonPhase, getMoonPosition, getMoonTimes, getSunPosition, getSunTimes } from './sky';

// Expected values are from suncalc 1.9.0, which uses the same formulas.
const CHAMONIX = {lat: 45.9237, lng: 6.8694};
const SEATTLE = {lat: 47.6062, lng: -122.3321};
const TROMSO = {lat: 69.6492, lng: 18.9553};
const MINUTE_MS = 60 * 1000;

function radians({lat, lng}: {lat: number; lng: number}): [number, number] {
  return [lat * Math.PI / 180, lng * Math.PI / 180];
}

function degrees(radians: number): number {
  return radians * 180 / Math.PI;
}

function expectNear(actual: number|undefined, expected: number, within: number): void {
  expect(actual).toBeDefined();
  expect(Math.abs(actual! - expected)).toBeLessThan(within);
}

test('Sun and moon positions', () => {
  const at = Date.parse('2026-06-21T12:00:00Z');
  const sun = getSunPosition(at, ...radians(CHAMONIX));
  expectNear(degrees(sun.azimuth), 195.0605, 0.01);
  expectNear(degrees(sun.altitude), 66.9323, 0.01);
  const moon = getMoonPosition(at, ...radians(CHAMONIX));
  expectNear(degrees(moon.azimuth), 97.8956, 0.01);
  expectNear(degrees(moon.altitude), 9.3236, 0.01);

  const winter = getSunPosition(Date.parse('2026-12-21T20:00:00Z'), ...radians(SEATTLE));
  expectNear(degrees(winter.azimuth), 178.1323, 0.01);
  expectNear(degrees(winter.altitude), 18.9339, 0.01);
});

test('Sun times', () => {
  const times = getSunTimes(Date.parse('2026-06-21T12:00:00Z'), ...radians(CHAMONIX));
  expectNear(times.noon, 1782041730867, MINUTE_MS);
  expectNear(times.sunrise, 1782013394189, MINUTE_MS);
  expectNear(times.sunset, 1782070067544, MINUTE_MS);
  expectNear(times.morningGolden?.end, 1782016171370, MINUTE_MS);
  expectNear(times.eveningGolden?.start, 1782067290363, MINUTE_MS);
  // Each period starts before it ends, and blue hour hands off to golden hour.
  expect(times.morningBlue!.start).toBeLessThan(times.morningBlue!.end);
  expectNear(times.morningGolden?.start, times.morningBlue!.end, 1);
  expect(times.eveningGolden!.end).toBeLessThan(times.eveningBlue!.end);

  const seattle = getSunTimes(Date.parse('2026-12-21T20:00:00Z'), ...radians(SEATTLE));
  expectNear(seattle.sunrise, 1797868564300, MINUTE_MS);
  expectNear(seattle.sunset, 1797898884472, MINUTE_MS);
});

test('Sun times under the midnight sun', () => {
  const times = getSunTimes(Date.parse('2026-06-21T12:00:00Z'), ...radians(TROMSO));
  expectNear(times.noon, 1782038829841, MINUTE_MS);
  expect(times.sunrise).toBeUndefined();
  expect(times.sunset).toBeUndefined();
});

test('Moon times and phase', () => {
  const chamonix = getMoonTimes(Date.parse('2026-06-21T00:00:00Z'), ...radians(CHAMONIX));
  expectNear(chamonix.moonrise, 1782039723823, MINUTE_MS);
  expectNear(chamonix.moonset, 1782084339311, MINUTE_MS);
  const seattle = getMoonTimes(Date.parse('2026-12-21T00:00:00Z'), ...radians(SEATTLE));
  expectNear(seattle.moonrise, 1797889968404, MINUTE_MS);
  expectNear(seattle.moonset, 1797860329476, MINUTE_MS);

  const phase = getMoonPhase(Date.parse('2026-06-21T12:00:00Z'));
  expectNear(phase.phase, 0.2346, 0.001);
  expectNear(phase.illumination, 0.4516, 0.001);
});
