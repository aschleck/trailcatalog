import { EditableLine } from './features';
import { getPositionAt } from './tracks';

function line(times: number[]|undefined): EditableLine {
  return {
    kind: 'line',
    id: crypto.randomUUID(),
    version: 0n,
    data: {},
    latLngE7: Int32Array.from([0, 0, 100, 200, 300, 600]),
    elevationCentimeters: Int32Array.from([1000, 2000, 4000]),
    timeSeconds: times ? BigInt64Array.from(times, BigInt) : undefined,
  };
}

test('interpolates between the points around the moment', () => {
  expect(getPositionAt([line([10, 20, 40])], 30))
      .toEqual({latE7: 200, lngE7: 400, elevationCentimeters: 3000});
});

test('lands on a point exactly', () => {
  expect(getPositionAt([line([10, 20, 40])], 20))
      .toEqual({latE7: 100, lngE7: 200, elevationCentimeters: 2000});
});

test('skips tracks without times or that miss the moment', () => {
  const found = line([100, 110, 120]);
  expect(getPositionAt([line(undefined), line([10, 20, 40]), found], 110))
      .toEqual({latE7: 100, lngE7: 200, elevationCentimeters: 2000});
});

test('finds nothing outside every track', () => {
  expect(getPositionAt([line([10, 20, 40])], 41)).toBeUndefined();
});
