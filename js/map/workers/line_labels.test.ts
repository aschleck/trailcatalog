import { lineAnchors, maxTurnWithin, mergeLines, newContour, polylineLength, smoothLine, uphillSide } from './line_labels';

test('merges pieces that share endpoints in either direction', () => {
  const merged = mergeLines([
    [2, 0, 3, 0],
    [0, 0, 1, 0],
    [2, 0, 1, 0],
    [5, 5, 6, 5],
  ]);

  expect(merged.length).toBe(2);
  const long = merged.find(line => line.length > 4)!;
  expect(polylineLength(long)).toBe(3);
  const xs = long.filter((_, i) => i % 2 === 0);
  expect([...xs].sort()).toEqual([0, 1, 2, 3]);
  expect(xs[0] === 0 || xs[0] === 3).toBe(true);
});

test('keeps a ring as one line', () => {
  const merged = mergeLines([
    [0, 0, 1, 0],
    [1, 0, 1, 1],
    [1, 1, 0, 0],
  ]);

  expect(merged.length).toBe(1);
  expect(merged[0].length).toBe(8);
});

test('anchors thin to even spacing by rank', () => {
  const anchors = lineAnchors(/* length= */ 100, /* spacing= */ 10, /* margin= */ 5);
  const at = (minRank: number) =>
      anchors.filter(a => a.rank >= minRank).map(a => a.at).sort((a, b) => a - b);

  expect(at(0)).toEqual([10, 20, 30, 40, 50, 60, 70, 80, 90]);
  expect(at(1)).toEqual([10, 30, 50, 70, 90]);
  expect(at(2)).toEqual([10, 50, 90]);
  expect(at(3)).toEqual([50]);
});

test('skips a line too short for its text', () => {
  expect(lineAnchors(/* length= */ 8, /* spacing= */ 10, /* margin= */ 5)).toEqual([]);
});

test('measures the turn inside a window', () => {
  // Two right-angle turns in the same direction 1 apart.
  const hook = [0, 0, 10, 0, 10, 1, 0, 1];

  expect(maxTurnWithin(hook, /* window= */ 0.5)).toBeCloseTo(Math.PI / 2);
  expect(maxTurnWithin(hook, /* window= */ 1)).toBeCloseTo(Math.PI);
});

test('lets opposite turns cancel', () => {
  // A jog left then right, which leaves text heading the way it started.
  const jog = [0, 0, 10, 0, 10, 1, 20, 1];

  expect(maxTurnWithin(jog, /* window= */ 1)).toBeCloseTo(Math.PI / 2);
  expect(maxTurnWithin(jog, /* window= */ 0.5)).toBeCloseTo(Math.PI / 2);
});

test('smoothing flattens jitter', () => {
  // Vertices a tenth apart wobbling a twentieth off a straight line, like a mapped stream.
  const zigzag = [];
  for (let i = 0; i <= 200; ++i) {
    zigzag.push(i / 10, i % 2 === 0 ? 0 : 0.05);
  }

  const smoothed = smoothLine(zigzag, /* step= */ 0.25, /* radius= */ 0.5);

  expect(maxTurnWithin(zigzag, /* window= */ 1)).toBeGreaterThan(Math.PI / 4);
  expect(maxTurnWithin(smoothed, /* window= */ 1)).toBeLessThan(Math.PI / 16);
});

test('finds the side that rises from the nearest crossing contour', () => {
  // Contours run east at y = -1, 0, and 2, climbing to the north
  const contours = [
    newContour(100, [-5, -1, 5, -1], [0]),
    newContour(200, [-5, 0, 5, 0], [0]),
    newContour(300, [-5, 2, 5, 2], [0]),
  ];

  // Heading east, north is on the left
  expect(uphillSide(0, 0, 0, 200, contours)).toBe(1);
  // Heading west, north is on the right
  expect(uphillSide(0, 0, Math.PI, 200, contours)).toBe(-1);
  // Only the 200 line crosses, to the north on the left, and it's higher
  expect(uphillSide(0, -1, 0, 100, contours.slice(1, 2))).toBe(1);
  expect(uphillSide(0, 0, 0, 200, [])).toBe(0);
});
