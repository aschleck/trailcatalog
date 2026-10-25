import { ArrayList, Bytes, S1Angle, S2Cell, S2CellId, S2LatLng, S2Loop, S2Point, S2Polygon, SimpleS2 }
    from 'java/org/trailcatalog/s2';

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

test('measures to the nearest point of a cell', () => {
  const ll = S2LatLng.fromDegrees(46.85, -121.75);
  const cell = S2Cell.fromCellId(S2CellId.fromLatLng(ll).parentAtLevel(10));
  expect(cell.getDistanceToPoint(ll.toPoint()).radians()).toBe(0);
  const far = S2LatLng.fromDegrees(47.85, -121.75);
  const toCenter = S2LatLng.fromPoint(cell.getCenter()).getDistance(far).radians();
  expect(cell.getDistanceToPoint(far.toPoint()).radians()).toBeLessThan(toCenter);
});

test('round trips a polygon through its coders', () => {
  const vertices = ArrayList.create<S2Point>();
  vertices.add(S2LatLng.fromDegrees(46, -122).toPoint());
  vertices.add(S2LatLng.fromDegrees(46, -121).toPoint());
  vertices.add(S2LatLng.fromDegrees(47, -121).toPoint());
  const polygon = S2Polygon.fromLoopArray(S2Loop.fromVertices(vertices));
  const encoded = S2Polygon.COMPACT_CODER.unsafeEncode(polygon);
  const decoded = S2Polygon.FAST_CODER.unsafeDecode(Bytes.fromByteArray(encoded));
  expect(decoded.numLoops()).toBe(1);
  expect(decoded.getArea()).toBeCloseTo(polygon.getArea());
  expect(S2Polygon.fromLoopArray().numLoops()).toBe(0);
});
