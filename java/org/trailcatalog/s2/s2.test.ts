import { S1Angle, S2CellId, S2LatLng } from 'java/org/trailcatalog/s2';
import { SimpleS2 } from 'java/org/trailcatalog/s2/SimpleS2';

test('finds the cell a point is in', () => {
  const ll = S2LatLng.fromDegrees(46.85, -121.75);
  const cell = S2CellId.fromLatLng(ll).parentAtLevel(10);
  expect(cell.level()).toBe(10);
  expect(S2CellId.fromLatLng(ll).parentAtLevel(12).parentAtLevel(10).toToken())
      .toBe(cell.toToken());
});

test('measures with the earth radius SimpleS2 uses', () => {
  const meters = SimpleS2.angleToEarthMeters(S1Angle.degrees(1));
  expect(meters).toBeCloseTo(SimpleS2.EARTH_RADIUS_METERS * Math.PI / 180);
  expect(SimpleS2.snapEpsilon(16)).toBeCloseTo(SimpleS2.snapRadians(16) / Math.PI);
});
