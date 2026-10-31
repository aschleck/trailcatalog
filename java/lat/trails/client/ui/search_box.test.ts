import { parseCoordinates } from './search_box';

test('coordinates parse with a comma or a space between them', () => {
  expect(parseCoordinates('47.6062, -122.3321')?.low).toEqual([47.6062, -122.3321]);
  expect(parseCoordinates(' 47.6062 -122.3321 ')?.low).toEqual([47.6062, -122.3321]);
  expect(parseCoordinates('46,-121')?.low).toEqual([46, -121]);
});

test('anything else is a name', () => {
  expect(parseCoordinates('camp muir')).toBeUndefined();
  expect(parseCoordinates('47.6062')).toBeUndefined();
  expect(parseCoordinates('Highway 2, 101')).toBeUndefined();
});

test('coordinates off the globe are a name', () => {
  expect(parseCoordinates('91, 0')).toBeUndefined();
  expect(parseCoordinates('0, 181')).toBeUndefined();
});
