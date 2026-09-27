import { Heap } from './heap';

/** Elevations on a square grid, row major. */
export interface ElevationGrid {
  // NaN where there is no data, which the router treats as impassable
  meters: Float32Array;
  width: number;
  height: number;
  // Ground distance between neighboring cell centers
  cellMeters: number;
}

/** The steepest a route may go, as rise over run, so 0.25 is a 25% grade. */
export interface GradeLimits {
  climb: number;
  descent: number;
}

// Tobler's hiking function peaks at 6 km/h on a 5% descent.
// https://en.wikipedia.org/wiki/Tobler%27s_hiking_function
const TOBLER_MAX_METERS_PER_SECOND = 6 / 3.6;

// A route can only head the ways a step can go. Following a contour means alternating the two
// headings either side of it, so on a slope S that works only where S * sin(gap) stays within the
// limit. Eight neighbors leave 45 degree gaps and knight's moves 27. These 32 leave at most 18,
// which follows any contour on slopes up to 3.2 times the limit and finds some heading within it
// up to 6.3 times.
// => 1 / sin(atan(1 / 3)) = 3.2
// => 1 / sin(atan(1 / 3) / 2) = 6.3
const HEADINGS = [[1, 0], [1, 1], [2, 1], [3, 1], [3, 2]].flatMap(([a, b]) => [
  [a, b], [-a, b], [a, -b], [-a, -b],
  [b, a], [-b, a], [b, -a], [-b, -a],
]).filter(([dx, dy], i, all) => all.findIndex(([x, y]) => x === dx && y === dy) === i);

// A step longer than one cell crosses cells without landing on them, so it would hop a cliff band
// one cell wide. We walk it in legs no longer than a cell, reading the height between legs from the
// four cells around each point.
interface Step {
  dx: number;
  dy: number;
  // Along the ground, in cells
  legRun: number;
  // Four per point between legs, as offsets from the step's start
  cornerDx: Int8Array;
  cornerDy: Int8Array;
  cornerWeights: Float64Array;
}

const STEPS: Step[] = HEADINGS.map(([dx, dy]) => {
  const legs = Math.abs(dx) + Math.abs(dy);
  const cornerDx = new Int8Array(4 * (legs - 1));
  const cornerDy = new Int8Array(4 * (legs - 1));
  const cornerWeights = new Float64Array(4 * (legs - 1));
  for (let i = 1; i < legs; ++i) {
    const x = dx * i / legs;
    const y = dy * i / legs;
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    const at = 4 * (i - 1);
    cornerDx.set([x0, x0 + 1, x0, x0 + 1], at);
    cornerDy.set([y0, y0, y0 + 1, y0 + 1], at);
    cornerWeights.set([(1 - fx) * (1 - fy), fx * (1 - fy), (1 - fx) * fy, fx * fy], at);
  }
  return {dx, dy, legRun: Math.hypot(dx, dy) / legs, cornerDx, cornerDy, cornerWeights};
});

/**
 * Returns the cells, as indices into the grid, of the quickest walk by Tobler's hiking function
 * from one cell to another that never steps steeper than the limits. Returns undefined when no walk
 * keeps within them.
 */
export function routeOverTerrain(
    grid: ElevationGrid, from: number, to: number, limits: GradeLimits): Int32Array|undefined {
  const {meters, width, height, cellMeters} = grid;
  if (Number.isNaN(meters[from]) || Number.isNaN(meters[to])) {
    return undefined;
  }

  const toX = to % width;
  const toY = Math.floor(to / width);
  const toZ = meters[to];
  // Climbing dz takes at least dz / limits.climb of ground, which bounds the walk tighter than the
  // straight line does wherever the ends are far apart in height.
  //
  // This heuristic is admissible but not consistent, because a steep descent can raise it by more
  // than the step costs when the descent limit is above the climb limit. So we let a settled cell
  // open again when a cheaper way reaches it.
  const heuristic = (cell: number) => {
    const dx = cell % width - toX;
    const dy = Math.floor(cell / width) - toY;
    const dz = toZ - meters[cell];
    const ground =
        Math.max(
            Math.hypot(dx, dy) * cellMeters,
            dz > 0 ? dz / limits.climb : -dz / limits.descent);
    return ground / TOBLER_MAX_METERS_PER_SECOND;
  };

  const cost = new Float64Array(width * height).fill(Infinity);
  const parent = new Int32Array(width * height).fill(-1);
  const heap = new Heap();
  cost[from] = 0;
  heap.push(heuristic(from), from);
  while (!heap.isEmpty) {
    const u = heap.pop();
    if (u === to) {
      break;
    }

    const ux = u % width;
    const uy = Math.floor(u / width);
    const uz = meters[u];
    for (const step of STEPS) {
      const vx = ux + step.dx;
      const vy = uy + step.dy;
      if (vx < 0 || vx >= width || vy < 0 || vy >= height) {
        continue;
      }

      const v = vy * width + vx;
      const vz = meters[v];
      if (Number.isNaN(vz)) {
        continue;
      }

      const legMeters = step.legRun * cellMeters;
      let seconds = 0;
      let z = uz;
      for (let i = 0; i < step.cornerWeights.length && seconds !== Infinity; i += 4) {
        let next = 0;
        for (let j = i; j < i + 4; ++j) {
          // Skipped rather than multiplied by 0, because a corner off the grid or without data
          // would make the height NaN.
          if (step.cornerWeights[j] > 0) {
            next +=
                step.cornerWeights[j]
                    * meters[(uy + step.cornerDy[j]) * width + ux + step.cornerDx[j]];
          }
        }
        seconds += stepSeconds(legMeters, next - z, limits);
        z = next;
      }
      seconds += stepSeconds(legMeters, vz - z, limits);
      if (Number.isNaN(seconds) || seconds === Infinity) {
        continue;
      }

      const through = cost[u] + seconds;
      if (through < cost[v]) {
        cost[v] = through;
        parent[v] = u;
        heap.push(through + heuristic(v), v);
      }
    }
  }

  if (cost[to] === Infinity) {
    return undefined;
  }

  const cells = [];
  for (let at = to; at !== -1; at = parent[at]) {
    cells.push(at);
  }
  return Int32Array.from(cells.reverse());
}

// Infinity past the limits, and NaN where rise crosses missing data
function stepSeconds(run: number, rise: number, limits: GradeLimits): number {
  const grade = rise / run;
  if (grade > limits.climb || -grade > limits.descent) {
    return Infinity;
  }
  return run / (TOBLER_MAX_METERS_PER_SECOND * Math.exp(-3.5 * Math.abs(grade + 0.05)));
}

/**
 * Drops the cells of a route that lie within tolerance of the line between the ones kept, by
 * Douglas-Peucker. Returns the kept cells as interleaved column then row.
 */
export function simplifyCells(cells: Int32Array, width: number, tolerance: number): Float64Array {
  const count = cells.length;
  const keep = new Uint8Array(count);
  keep[0] = 1;
  keep[count - 1] = 1;
  const stack = count > 2 ? [0, count - 1] : [];
  while (stack.length > 0) {
    const last = stack.pop()!;
    const first = stack.pop()!;
    const ax = cells[first] % width;
    const ay = Math.floor(cells[first] / width);
    const bx = cells[last] % width;
    const by = Math.floor(cells[last] / width);
    const length = Math.hypot(bx - ax, by - ay);
    let farthest = -1;
    let farthestDistance = tolerance;
    for (let i = first + 1; i < last; ++i) {
      const px = cells[i] % width;
      const py = Math.floor(cells[i] / width);
      // A quickest walk never visits a cell twice, so length is never 0.
      const distance = Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / length;
      if (distance > farthestDistance) {
        farthest = i;
        farthestDistance = distance;
      }
    }
    if (farthest >= 0) {
      keep[farthest] = 1;
      stack.push(first, farthest, farthest, last);
    }
  }

  const kept = [];
  for (let i = 0; i < count; ++i) {
    if (keep[i]) {
      kept.push(cells[i] % width, Math.floor(cells[i] / width));
    }
  }
  return Float64Array.from(kept);
}
