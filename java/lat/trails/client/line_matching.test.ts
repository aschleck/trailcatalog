import { Vec2 } from 'js/map/common/types';
import { LineRef, Route } from 'js/map/workers/location_querier';

import {
  appendRoute,
  appendTrace,
  emptyTrace,
  pushPoint,
  refine,
  routeTrace,
  Traced,
  traceRefs,
} from './line_matching';

const A: LineRef = {url: '/c', id: {lsb: 1n, msb: 0n}};
const B: LineRef = {url: '/c', id: {lsb: 2n, msb: 0n}};

// A zigzag the simplifier flattened to its ends
const ZIGZAG = Float64Array.of(0, 0, 1, 0.1, 2, 0, 3, 0.1, 4, 0);

test('swaps a run for the line it followed', () => {
  const refined = refine(trace([0, 0], [4, 0, A]), geometry());
  expect(Array.from(refined.points)).toEqual(Array.from(ZIGZAG));
  expect(Array.from(refined.at)).toEqual([0, 4]);
});

test('follows a run backwards', () => {
  const refined = refine(trace([4, 0], [2, 0, A]), geometry());
  expect(Array.from(refined.points)).toEqual([4, 0, 3, 0.1, 2, 0]);
});

test('starts a run partway along a segment', () => {
  const points = Array.from(refine(trace([2.5, 0], [4, 0, A]), geometry()).points);
  expect(points.slice(2)).toEqual([3, 0.1, 4, 0]);
  expect(points[0]).toBeCloseTo(2.5);
  expect(points[1]).toBeCloseTo(0.05);
});

test('joins two runs at the vertex they share', () => {
  const branch = Float64Array.of(4, 0, 4.1, 1, 4, 2);
  const refined = refine(trace([0, 0], [4, 0, A], [4, 2, B]), geometry(branch));
  expect(Array.from(refined.points)).toEqual([...ZIGZAG, 4.1, 1, 4, 2]);
  expect(Array.from(refined.at)).toEqual([0, 4, 6]);
});

test('keeps the order of a line that passes a vertex twice', () => {
  // Out along the bottom, round, and back through (1, 0) to finish west of where it began
  const loop = Float64Array.of(0, 0, 1, 0, 2, 0, 2, 1, 1, 1, 1, 0, 1, -1);
  const refined =
      refine(
          trace([0, 0], [2, 0, A], [1, 0, A], [1, -1, A]),
          ref => ref === A ? loop : undefined);
  expect(Array.from(refined.points)).toEqual(Array.from(loop));
});

test('leaves a run alone without its line', () => {
  const refined = refine(trace([0, 0], [4, 0, A]), () => undefined);
  expect(Array.from(refined.points)).toEqual([0, 0, 4, 0]);
});

test('moves a lone snapped point onto its line', () => {
  const lone = emptyTrace();
  pushPoint(lone, [2, -0.5], undefined, A);
  pushPoint(lone, [9, 9], undefined, undefined);
  expect(Array.from(refine(lone, geometry()).points)).toEqual([2, 0, 9, 9]);
});

test('moves the snapped ends of a run it cannot place onto their line', () => {
  // The run claims A, but its second point equals a vertex of A that comes before the first.
  const backwards = Float64Array.of(0, 0, 1, 0, 2, 0);
  const run = emptyTrace();
  pushPoint(run, [2, 0.5], undefined, A);
  pushPoint(run, [1, 0], A, undefined);
  pushPoint(run, [0, 0], A, undefined);
  pushPoint(run, [2, 0], A, A);
  const points = Array.from(refine(run, ref => ref === A ? backwards : undefined).points);
  expect(points.slice(0, 2)).toEqual([2, 0]);
});

test('keeps a shared point where the last run put it when the next run cannot be placed', () => {
  // The second run claims B, but its points visit B's vertices out of order.
  const backwards = Float64Array.of(0, 0, 1, 0, 2, 0);
  const t = trace([0, 0]);
  pushPoint(t, [2.5, 0], A, B);
  pushPoint(t, [1, 0], B, undefined);
  pushPoint(t, [0, 0], B, undefined);
  pushPoint(t, [2, 0], B, undefined);
  const refined =
      refine(t, ref => ref === A ? ZIGZAG : ref === B ? backwards : undefined);
  const points = Array.from(refined.points);
  // Where the first run ended on A, then straight on to the second run's other points, with no
  // stop at (2, 0) on B in between
  expect(points.slice(0, 6)).toEqual([0, 0, 1, 0.1, 2, 0]);
  expect(points[6]).toBeCloseTo(2.5);
  expect(points[7]).toBeCloseTo(0.05);
  expect(points.slice(8)).toEqual([1, 0, 0, 0, 2, 0]);
  expect(refined.at[1]).toBe(3);
});

test('appends a route that starts where the trace ends', () => {
  const t = trace([0, 0]);
  appendRoute(t, route([0, 0], [[1, 0], [2, 0]], [3, 0], [A, A, B], B));
  expect(t.points).toEqual([0, 0, 1, 0, 2, 0, 3, 0]);
  expect(t.lines).toEqual([undefined, A, A, B]);
  expect(t.on).toEqual([undefined, undefined, undefined, B]);
});

test('reaches a route that starts elsewhere with a straight segment', () => {
  const t = trace([0, 1]);
  appendRoute(t, route([0, 0], [[1, 0]], [2, 0], [A, A], A));
  expect(t.points).toEqual([0, 1, 0, 0, 1, 0, 2, 0]);
  expect(t.lines).toEqual([undefined, undefined, A, A]);
});

test('goes straight to the end of a route with no via', () => {
  const t = trace([0, 0]);
  appendRoute(t, {from: [0, 0.5], to: [5, 5], via: undefined, lines: undefined, toLine: B});
  expect(t.points).toEqual([0, 0, 5, 5]);
  expect(t.lines).toEqual([undefined, undefined]);
  expect(t.on).toEqual([undefined, B]);
});

test('starts an empty trace where its first route does', () => {
  const t = emptyTrace();
  appendRoute(t, route([0, 0], [], [1, 0], [A], undefined));
  expect(t.points).toEqual([0, 0, 1, 0]);
  expect(t.lines).toEqual([undefined, A]);
});

test('joins vertex traces the way the drawing layer lays them out', () => {
  // Each vertex holds the path from past the previous vertex up to itself.
  const first = trace([0, 0]);
  const second = routeTrace([0, 0], route([0, 0], [], [4, 0], [A], A));
  expect(second.points).toEqual([4, 0]);

  const drawn = emptyTrace();
  appendTrace(drawn, first);
  appendTrace(drawn, second);
  expect(drawn.points).toEqual([0, 0, 4, 0]);
  expect(Array.from(refine(drawn, geometry()).points)).toEqual(Array.from(ZIGZAG));
  expect(traceRefs(drawn)).toEqual([A, A]);
});

test('joins a reroute through a point the way the feature layer lays it out', () => {
  const t = trace([0, -1]);
  appendRoute(t, route([0, 0], [], [2, 0], [A], A));
  appendRoute(t, route([2, 0], [], [4, 0], [A], A));
  pushPoint(t, [4, -1], undefined, undefined);
  const refined = Array.from(refine(t, geometry()).points);
  expect(refined).toEqual([0, -1, ...Array.from(ZIGZAG), 4, -1]);
});

// A trace through points given as [x, y] or [x, y, the line the segment reaching it ran along]
function trace(...points: Array<[number, number, LineRef?]>): Traced {
  const t = emptyTrace();
  for (const [x, y, line] of points) {
    pushPoint(t, [x, y], line, undefined);
  }
  return t;
}

function route(from: Vec2, via: Vec2[], to: Vec2, lines: LineRef[], toLine: LineRef|undefined):
    Route {
  return {from, via: Float64Array.from(via.flat()), to, lines, toLine};
}

function geometry(branch?: Float64Array): (ref: LineRef) => Float64Array|undefined {
  return ref => ref === A ? ZIGZAG : ref === B ? branch : undefined;
}
