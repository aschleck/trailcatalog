import { EditableLine } from './features';
import { parseGpx } from './gpx';

// A waypoint, a route to be dropped, a segment with everything, a segment missing one elevation
// and one time, a segment of a single point, and a segment carrying a point with no coordinates.
const GPX = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="test" xmlns="http://www.topografix.com/GPX/1/1">
  <wpt lat="46.8000000" lon="-121.8000000"><ele>1645.5</ele><name>Paradise</name></wpt>
  <rte><rtept lat="46.8100000" lon="-121.8100000" /></rte>
  <trk>
    <name>Camp Muir</name>
    <trkseg>
      <trkpt lat="46.8593690" lon="-121.7478880">
        <ele>1400.00</ele>
        <time>2026-08-23T15:06:40Z</time>
      </trkpt>
      <trkpt lat="46.8603690" lon="-121.7468880">
        <ele>1400.60</ele>
        <time>2026-08-23T15:06:41Z</time>
      </trkpt>
      <trkpt lat="46.8613690" lon="-121.7458880">
        <ele>1401.10</ele>
        <time>2026-08-23T15:06:43Z</time>
      </trkpt>
    </trkseg>
    <trkseg>
      <trkpt lat="46.8623690" lon="-121.7448880"><ele>1402.00</ele></trkpt>
      <trkpt lat="46.8633690" lon="-121.7438880"><time>2026-08-23T15:07:00Z</time></trkpt>
    </trkseg>
    <trkseg>
      <trkpt lat="46.8643690" lon="-121.7428880" />
    </trkseg>
    <trkseg>
      <trkpt lat="46.8653690" lon="-121.7418880" />
      <trkpt lat="46.8663690" />
    </trkseg>
  </trk>
</gpx>
`;

test('reads a waypoint', () => {
  const points = parseGpx(GPX).filter(f => f.kind === 'point');
  expect(points).toEqual([{
    kind: 'point',
    id: expect.stringMatching(/^[0-9a-f-]{36}$/),
    version: 0n,
    data: {name: 'Paradise'},
    latE7: 468000000,
    lngE7: -1218000000,
    elevationCentimeters: 164550,
  }]);
});

test('reads a track segment', () => {
  const lines = linesOf(GPX);
  expect(lines).toHaveLength(2);

  const line = lines[0];
  expect(line.data).toEqual({name: 'Camp Muir'});
  expect(Array.from(line.latLngE7)).toEqual([
    468593690, -1217478880,
    468603690, -1217468880,
    468613690, -1217458880,
  ]);
  expect(Array.from(line.elevationCentimeters ?? [])).toEqual([140000, 140060, 140110]);
  expect(Array.from(line.timeSeconds ?? [])).toEqual([
    1787497600n,
    1787497601n,
    1787497603n,
  ]);
});

test('drops samples the whole segment does not carry', () => {
  const lines = linesOf(GPX);
  expect(lines[1].elevationCentimeters).toBeUndefined();
  expect(lines[1].timeSeconds).toBeUndefined();
  expect(Array.from(lines[1].latLngE7)).toEqual([468623690, -1217448880, 468633690, -1217438880]);
});

test('gives every line its own id', () => {
  const lines = linesOf(GPX);
  expect(lines[0].id).not.toEqual(lines[1].id);
  expect(lines[0].id).toMatch(/^[0-9a-f-]{36}$/);
});

test('drops a segment missing a coordinate', () => {
  // The bad segment is last, so anything before it still comes through.
  expect(linesOf(GPX)).toHaveLength(2);
});

test('rejects what is not a gpx', () => {
  expect(() => parseGpx('this is not xml at all <')).toThrow();
});

function linesOf(gpx: string): EditableLine[] {
  return parseGpx(gpx).filter(f => f.kind === 'line');
}
