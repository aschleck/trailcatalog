import { segmentLabel } from './label_text';

test('splits Latin into graphemes', () => {
  expect(segmentLabel('Mt. Rainier')).toEqual(['M', 't', '.', ' ', 'R', 'a', 'i', 'n', 'i', 'e', 'r']);
});

test('keeps combining marks with their letter', () => {
  expect(segmentLabel('Lake Ozetté')).toContain('é');
});

test('wraps at the first space past the line length', () => {
  expect(segmentLabel('Mount Rainier National Park', 8).join('')).toBe(
      'Mount Rainier\nNational\nPark');
});

test('draws Arabic a word at a time, right to left', () => {
  expect(segmentLabel('شارع الهرم')).toEqual(['الهرم', ' ', 'شارع']);
});

test('draws Hebrew a word at a time, right to left', () => {
  expect(segmentLabel('תל אביב')).toEqual(['אביב', ' ', 'תל']);
});

test('draws Devanagari a word at a time, left to right', () => {
  expect(segmentLabel('नई दिल्ली')).toEqual(['नई', ' ', 'दिल्ली']);
});

// How finely Thai splits depends on whether ICU has its dictionary, which Node may not.
test('draws Thai in words rather than graphemes', () => {
  const units = segmentLabel('กรุงเทพมหานคร');
  expect(units.join('')).toBe('กรุงเทพมหานคร');
  expect(units.length).toBeLessThan(5);
});

test('keeps Latin graphemes beside an Arabic word', () => {
  expect(segmentLabel('Cairo القاهرة')).toEqual(['C', 'a', 'i', 'r', 'o', ' ', 'القاهرة']);
});

test('keeps numbers left to right inside Arabic', () => {
  expect(segmentLabel('شارع 26 يوليو')).toEqual(['يوليو', ' ', '2', '6', ' ', 'شارع']);
});

test('mirrors brackets inside Arabic', () => {
  expect(segmentLabel('مصر (القاهرة)')).toEqual(['(', 'القاهرة', ')', ' ', 'مصر']);
});

test('wraps Arabic lines in reading order', () => {
  expect(segmentLabel('شارع جامعة الدول العربية', 8)).toEqual(
      ['جامعة', ' ', 'شارع', '\n', 'العربية', ' ', 'الدول']);
});

test('splits accented Latin the same as ASCII', () => {
  expect(segmentLabel('Café du Monde', 8)).toEqual(
      ['C', 'a', 'f', 'é', ' ', 'd', 'u', ' ', 'M', 'o', 'n', 'd', 'e']);
});
