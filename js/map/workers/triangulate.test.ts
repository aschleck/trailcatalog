import { ringArea, triangulateMb, Triangles } from './triangulate';

// A z=5 tile column, in the mercator coordinates triangulateMb consumes. The horizontal boundary at
// y = 0.375 (lat 55.78) is the seam the basemap used to tear along.
const LEFT = -0.8125;
const RIGHT = -0.75;
const SEAM = 0.375;
const ABOVE = 0.4375;
const BELOW = 0.3125;
const MAX_TRIANGLE_LENGTH_METERS = 200_000;

type Point = [number, number];

// Rings are implicitly closed. triangulateMb reads shells as the rings with positive ringArea,
// which is clockwise once y points up, so shells go bottom-left, up, right, down.
function rings(...loops: Point[][]): {geometry: number[], starts: number[]} {
  const geometry: number[] = [];
  const starts: number[] = [];
  for (const loop of loops) {
    starts.push(geometry.length);
    for (const [x, y] of loop) {
      geometry.push(x, y);
    }
  }
  return {geometry, starts};
}

function box(left: number, bottom: number, right: number, top: number): Point[] {
  return [[left, bottom], [left, top], [right, top], [right, bottom]];
}

function reversed(loop: Point[]): Point[] {
  return [...loop].reverse();
}

// Every x where a triangle edge lying along the horizontal line y === at starts or ends. This is
// what the GPU actually draws along a seam, and two tiles must agree on it or the differing 3D
// chords leave a hairline gap on the globe.
function seamVertices(t: Triangles, at: number): number[] {
  const g = t.geometry;
  const xs = new Set<number>();
  for (let i = 0; i < t.index.length; i += 3) {
    const tri = [t.index[i], t.index[i + 1], t.index[i + 2]];
    for (let e = 0; e < 3; ++e) {
      const p = tri[e];
      const q = tri[(e + 1) % 3];
      if (g[2 * p + 1] === at && g[2 * q + 1] === at && g[2 * p] !== g[2 * q]) {
        xs.add(g[2 * p]);
        xs.add(g[2 * q]);
      }
    }
  }
  return [...xs].sort((a, b) => a - b);
}

function coveredArea(t: Triangles): number {
  const g = t.geometry;
  let area = 0;
  for (let i = 0; i < t.index.length; i += 3) {
    const a = t.index[i], b = t.index[i + 1], c = t.index[i + 2];
    area += Math.abs(
        (g[2 * b] - g[2 * a]) * (g[2 * c + 1] - g[2 * a + 1])
            - (g[2 * c] - g[2 * a]) * (g[2 * b + 1] - g[2 * a + 1])) / 2;
  }
  return area;
}

// Triangles all wound the same way, since CULL_FACE would drop the odd one out.
function windings(t: Triangles): Set<number> {
  const g = t.geometry;
  const signs = new Set<number>();
  for (let i = 0; i < t.index.length; i += 3) {
    const a = t.index[i], b = t.index[i + 1], c = t.index[i + 2];
    const cross = (g[2 * b] - g[2 * a]) * (g[2 * c + 1] - g[2 * a + 1])
        - (g[2 * c] - g[2 * a]) * (g[2 * b + 1] - g[2 * a + 1]);
    signs.add(Math.sign(cross));
  }
  return signs;
}

// No edge may be used by more than two triangles; more than that means they overlap.
function maxEdgeUses(t: Triangles): number {
  const g = t.geometry;
  const uses = new Map<string, number>();
  for (let i = 0; i < t.index.length; i += 3) {
    const tri = [t.index[i], t.index[i + 1], t.index[i + 2]];
    for (let e = 0; e < 3; ++e) {
      const p = tri[e];
      const q = tri[(e + 1) % 3];
      const kp = `${g[2 * p]},${g[2 * p + 1]}`;
      const kq = `${g[2 * q]},${g[2 * q + 1]}`;
      const key = kp < kq ? `${kp}|${kq}` : `${kq}|${kp}`;
      uses.set(key, (uses.get(key) ?? 0) + 1);
    }
  }
  return Math.max(0, ...uses.values());
}

function triangulate(loops: Point[][], maxLength = MAX_TRIANGLE_LENGTH_METERS): Triangles {
  const {geometry, starts} = rings(...loops);
  return triangulateMb(geometry, starts, maxLength);
}

test('reads shells as positive area and holes as negative', () => {
  const shell = box(LEFT, SEAM, RIGHT, ABOVE);
  const {geometry} = rings(shell);
  expect(ringArea(geometry, 0, geometry.length)).toBeGreaterThan(0);

  const {geometry: flipped} = rings(reversed(shell));
  expect(ringArea(flipped, 0, flipped.length)).toBeLessThan(0);
});

test('covers a shell exactly, with consistent winding', () => {
  // Small enough that nothing subdivides, so this pins the plain earcut path.
  const t = triangulate([box(-0.001, 0.001, 0.001, 0.003)]);
  expect(t.index.length / 3).toBe(2);
  expect(coveredArea(t)).toBeCloseTo(0.002 * 0.002, 12);
  expect(windings(t).size).toBe(1);
  expect(maxEdgeUses(t)).toBeLessThanOrEqual(2);
});

test('cuts a hole out of its shell', () => {
  const t = triangulate([
    box(-0.004, 0.001, 0.004, 0.009),
    reversed(box(-0.002, 0.003, 0.002, 0.007)),
  ]);
  expect(coveredArea(t)).toBeCloseTo(0.008 * 0.008 - 0.004 * 0.004, 12);
  expect(windings(t).size).toBe(1);
  expect(maxEdgeUses(t)).toBeLessThanOrEqual(2);
});

test('assigns each hole to the shell that contains it', () => {
  // Two disjoint shells, each with its own hole. Attaching a hole to the wrong shell shows up as
  // overlapping triangles and too much covered area.
  const t = triangulate([
    box(-0.010, 0.001, -0.002, 0.009),
    reversed(box(-0.008, 0.003, -0.004, 0.007)),
    box(0.002, 0.001, 0.010, 0.009),
    reversed(box(0.004, 0.003, 0.008, 0.007)),
  ]);
  expect(coveredArea(t)).toBeCloseTo(2 * (0.008 * 0.008 - 0.004 * 0.004), 12);
  expect(windings(t).size).toBe(1);
  expect(maxEdgeUses(t)).toBeLessThanOrEqual(2);
});

test('subdivides edges that are too long to draw straight on the globe', () => {
  const whole = triangulate([box(LEFT, SEAM, RIGHT, ABOVE)]);
  const unsplit = triangulate([box(LEFT, SEAM, RIGHT, ABOVE)], Infinity);
  expect(whole.index.length).toBeGreaterThan(unsplit.index.length);
  // Subdividing must not change what is covered.
  expect(coveredArea(whole)).toBeCloseTo(coveredArea(unsplit), 12);
  expect(windings(whole).size).toBe(1);
  expect(maxEdgeUses(whole)).toBeLessThanOrEqual(2);
});

test('splits a tile-boundary edge on a grid of powers of two', () => {
  const t = triangulate([box(LEFT, SEAM, RIGHT, ABOVE)]);
  const xs = seamVertices(t, SEAM);
  expect(xs.length).toBeGreaterThan(2);
  for (const x of xs) {
    // Every split lands on a dyadic coordinate, which is what lets neighbours agree. 2^-20 is far
    // finer than any split a 200 km threshold produces.
    expect(Number.isInteger(x * Math.pow(2, 20))) .toBe(true);
  }
});

test('tiles above and below a seam tessellate it identically', () => {
  // The regression: each tile clips and triangulates on its own, so the only thing keeping their
  // shared edge from tearing is that they independently arrive at the same split points.
  const above = triangulate([box(LEFT, SEAM, RIGHT, ABOVE)]);
  const below = triangulate([box(LEFT, BELOW, RIGHT, SEAM)]);
  expect(seamVertices(below, SEAM)).toEqual(seamVertices(above, SEAM));
  expect(seamVertices(above, SEAM).length).toBeGreaterThan(2);
});

test('tiles left and right of a meridian seam tessellate it identically', () => {
  const west = triangulate([box(LEFT, BELOW, RIGHT, ABOVE)]);
  const east = triangulate([box(RIGHT, BELOW, RIGHT + (RIGHT - LEFT), ABOVE)]);
  const on = (t: Triangles, at: number) => {
    const g = t.geometry;
    const ys = new Set<number>();
    for (let i = 0; i < t.index.length; i += 3) {
      const tri = [t.index[i], t.index[i + 1], t.index[i + 2]];
      for (let e = 0; e < 3; ++e) {
        const p = tri[e];
        const q = tri[(e + 1) % 3];
        if (g[2 * p] === at && g[2 * q] === at && g[2 * p + 1] !== g[2 * q + 1]) {
          ys.add(g[2 * p + 1]);
          ys.add(g[2 * q + 1]);
        }
      }
    }
    return [...ys].sort((a, b) => a - b);
  };
  expect(on(east, RIGHT)).toEqual(on(west, RIGHT));
  expect(on(west, RIGHT).length).toBeGreaterThan(2);
});

test('a seam vertex off the dyadic grid still splits onto it', () => {
  // A coastline touching the boundary leaves an arbitrary vertex on it. The edges either side of
  // that vertex must still be cut on the shared grid rather than at their own midpoints, so a
  // neighbour that lacks the vertex lands on the same interior points.
  const odd = LEFT + 0.371 * (RIGHT - LEFT);
  const withVertex = triangulate([[
    [LEFT, SEAM], [LEFT, ABOVE], [RIGHT, ABOVE], [RIGHT, SEAM], [odd, SEAM],
  ]]);
  const xs = seamVertices(withVertex, SEAM);
  for (const x of xs) {
    if (x === odd) {
      continue;
    }
    expect(Number.isInteger(x * Math.pow(2, 20))).toBe(true);
  }
});
