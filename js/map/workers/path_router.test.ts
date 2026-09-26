import { Vec2 } from '../common/types';

import { Anchor, PathRouter } from './path_router';

// Wider than any network here, so only the tests about reach are bounded by it.
const REACH = 100;

// A tee: a straight way from (0, 0) to (2, 0) with a second one hanging off its middle vertex.
const TEE = [
  Float64Array.of(0, 0, 1, 0, 2, 0),
  Float64Array.of(1, 0, 1, 1),
];

test('routes along one line', () => {
  const router = build(TEE);
  const via =
      router.route(anchor([0.5, 0], [0, 0], [1, 0]), anchor([1.5, 0], [1, 0], [2, 0]), REACH);
  expect(Array.from(via ?? [])).toEqual([1, 0]);
});

test('routes across a junction', () => {
  const router = build(TEE);
  const via =
      router.route(anchor([0.5, 0], [0, 0], [1, 0]), anchor([1, 0.5], [1, 0], [1, 1]), REACH);
  expect(Array.from(via ?? [])).toEqual([1, 0]);
});

test('routes between points on one segment', () => {
  const router = build(TEE);
  const via =
      router.route(anchor([0.25, 0], [0, 0], [1, 0]), anchor([0.75, 0], [0, 0], [1, 0]), REACH);
  expect(Array.from(via ?? [])).toEqual([]);
});

test('drops an end that repeats its anchor', () => {
  const router = build(TEE);
  const via = router.route(anchor([1, 0], [0, 0], [1, 0]), anchor([1, 1], [1, 0], [1, 1]), REACH);
  expect(Array.from(via ?? [])).toEqual([]);
});

test('takes the shorter of two ways around', () => {
  // A square with a detour hanging off the long way round, so the wrong answer is reachable and
  // the search has somewhere to waste itself.
  const router =
      build([
        Float64Array.of(0, 0, 0, 1, 1, 1),
        Float64Array.of(0, 0, 1, 0, 1, 1),
        Float64Array.of(0, 1, -1, 2),
      ]);
  const via = router.route(anchor([0, 0], [0, 0], [1, 0]), anchor([1, 1], [1, 0], [1, 1]), REACH);
  expect(Array.from(via ?? [])).toEqual([1, 0]);
});

test('finds nothing between two networks', () => {
  const router = build([Float64Array.of(0, 0, 1, 0), Float64Array.of(5, 5, 6, 5)]);
  const via =
      router.route(anchor([0.5, 0], [0, 0], [1, 0]), anchor([5.5, 5], [5, 5], [6, 5]), REACH);
  expect(via).toBeUndefined();
});

// Lines in one group only meet at shared vertices, because the server keeps the ones a tile's
// paths share.
test('does not join an end onto a segment in its own group', () => {
  const router = build([Float64Array.of(0, 0, 2, 0), Float64Array.of(1, 0, 1, 1)]);
  const via =
      router.route(anchor([0.5, 0], [0, 0], [2, 0]), anchor([1, 0.5], [1, 0], [1, 1]), REACH);
  expect(via).toBeUndefined();
});

test('routes onto a segment another group ends on', () => {
  const router = new PathRouter();
  router.load('through', [Float64Array.of(0, 0, 2, 0)], /* tolerance= */ 0);
  router.load('branch', [Float64Array.of(1, 0.001, 1, 1)], /* tolerance= */ 0.01);

  const via =
      router.route(anchor([0.5, 0], [0, 0], [2, 0]), anchor([1, 0.5], [1, 0.001], [1, 1]), REACH);
  expect(Array.from(via ?? [])).toEqual([1, 0.001]);
});

test('routes off a segment another group ends on', () => {
  const router = new PathRouter();
  router.load('through', [Float64Array.of(0, 0, 2, 0)], /* tolerance= */ 0);
  router.load('branch', [Float64Array.of(1, 0.001, 1, 1)], /* tolerance= */ 0.01);

  const via =
      router.route(anchor([1, 0.5], [1, 0.001], [1, 1]), anchor([1.5, 0], [0, 0], [2, 0]), REACH);
  expect(Array.from(via ?? [])).toEqual([1, 0.001]);
});

test('does not join an end past tolerance', () => {
  const router = new PathRouter();
  router.load('through', [Float64Array.of(0, 0, 2, 0)], /* tolerance= */ 0);
  router.load('branch', [Float64Array.of(1, 0.1, 1, 1)], /* tolerance= */ 0.01);

  const via =
      router.route(anchor([0.5, 0], [0, 0], [2, 0]), anchor([1, 0.5], [1, 0.1], [1, 1]), REACH);
  expect(via).toBeUndefined();
});

test('routes a detour within reach', () => {
  // Two points a unit apart joined only by a way that runs out 10 and back.
  const router = build([Float64Array.of(0, 0, 0, 10, 1, 10, 1, 0)]);
  const via =
      router.route(
          anchor([0, 0.5], [0, 0], [0, 10]), anchor([1, 0.5], [1, 10], [1, 0]), /* reach= */ 10);
  expect(Array.from(via ?? [])).toEqual([0, 10, 1, 10]);
});

test('gives up on a detour past reach', () => {
  const router = build([Float64Array.of(0, 0, 0, 10, 1, 10, 1, 0)]);
  const via =
      router.route(
          anchor([0, 0.5], [0, 0], [0, 10]), anchor([1, 0.5], [1, 10], [1, 0]), /* reach= */ 5);
  expect(via).toBeUndefined();
});

test('routes across two groups', () => {
  const router = new PathRouter();
  router.load('a', [Float64Array.of(0, 0, 1, 0)], /* tolerance= */ 0);
  router.load('b', [Float64Array.of(1, 0, 2, 0)], /* tolerance= */ 0);

  const via =
      router.route(anchor([0.5, 0], [0, 0], [1, 0]), anchor([1.5, 0], [1, 0], [2, 0]), REACH);
  expect(Array.from(via ?? [])).toEqual([1, 0]);
});

test('finds nothing once the group joining two others goes', () => {
  const router = new PathRouter();
  router.load('a', [Float64Array.of(0, 0, 1, 0)], /* tolerance= */ 0);
  router.load('joiner', [Float64Array.of(1, 0, 2, 0)], /* tolerance= */ 0);
  router.load('c', [Float64Array.of(2, 0, 3, 0)], /* tolerance= */ 0);
  router.unload('joiner');

  const via =
      router.route(anchor([0.5, 0], [0, 0], [1, 0]), anchor([2.5, 0], [2, 0], [3, 0]), REACH);
  expect(via).toBeUndefined();
});

test('reloading a group replaces its edges', () => {
  const router = new PathRouter();
  router.load('a', [Float64Array.of(0, 0, 1, 0, 2, 0)], /* tolerance= */ 0);
  router.load('a', [Float64Array.of(0, 0, 1, 0)], /* tolerance= */ 0);

  const via =
      router.route(anchor([0.5, 0], [0, 0], [1, 0]), anchor([1.5, 0], [1, 0], [2, 0]), REACH);
  expect(via).toBeUndefined();
});

test('routes after the dead nodes are compacted away', () => {
  const router = new PathRouter();
  router.load('tee', TEE, /* tolerance= */ 0);
  // Route first, or else the tee is never noded and its edges never count as dead.
  router.route(anchor([0.5, 0], [0, 0], [1, 0]), anchor([1.5, 0], [1, 0], [2, 0]), REACH);
  router.unload('tee');
  // Two live edges against the tee's three dead ones, which is what trips the compaction.
  router.load('bar', [Float64Array.of(4, 0, 5, 0, 6, 0)], /* tolerance= */ 0);

  const via =
      router.route(anchor([4.5, 0], [4, 0], [5, 0]), anchor([5.5, 0], [5, 0], [6, 0]), REACH);
  expect(Array.from(via ?? [])).toEqual([5, 0]);
});

test('routes over a line that repeats a point', () => {
  const router = build([Float64Array.of(0, 0, 1, 0, 1, 0, 2, 0)]);
  const via =
      router.route(anchor([0.5, 0], [0, 0], [1, 0]), anchor([1.5, 0], [1, 0], [2, 0]), REACH);
  expect(Array.from(via ?? [])).toEqual([1, 0]);
});

function build(lines: Float64Array[]): PathRouter {
  const router = new PathRouter();
  router.load('lines', lines, /* tolerance= */ 0);
  return router;
}

function anchor(point: Vec2, a: Vec2, b: Vec2): Anchor {
  return {point, a, b};
}
