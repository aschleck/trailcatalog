import { fromWallClock, isKnownZone, toWallClock } from './time_zones';

test('round trips a wall clock time', () => {
  const at = Date.UTC(2026, 6, 4, 19, 30);
  expect(toWallClock(at, 'America/Denver')).toBe('2026-07-04T13:30');
  expect(fromWallClock('2026-07-04T13:30', 'America/Denver')).toBe(at);
  expect(toWallClock(at, 'Asia/Kathmandu')).toBe('2026-07-05T01:15');
  expect(fromWallClock('2026-07-05T01:15', 'Asia/Kathmandu')).toBe(at);
});

test('reads a time the clock skips as an hour later', () => {
  // Los Angeles springs from 2:00 PST to 3:00 PDT on 2026-03-08
  const at = fromWallClock('2026-03-08T02:30', 'America/Los_Angeles');
  expect(at).toBe(Date.UTC(2026, 2, 8, 10, 30));
  expect(toWallClock(at, 'America/Los_Angeles')).toBe('2026-03-08T03:30');
});

test('reads a time the clock repeats as the earlier one', () => {
  // Los Angeles falls from 2:00 PDT back to 1:00 PST on 2026-11-01
  expect(fromWallClock('2026-11-01T01:30', 'America/Los_Angeles'))
      .toBe(Date.UTC(2026, 10, 1, 8, 30));
});

test('rejects what is not a time', () => {
  expect(fromWallClock('', 'UTC')).toBeNaN();
});

test('knows tzdb zones and nothing else', () => {
  expect(isKnownZone('Etc/GMT+8')).toBe(true);
  expect(isKnownZone('Mars/Olympus_Mons')).toBe(false);
});
