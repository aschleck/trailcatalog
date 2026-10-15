import { Vec2 } from 'js/map/common/types';
import { LineRef, Route } from 'js/map/workers/location_querier';

// A polyline along with what it ran along, kept per point so that two traces join by
// concatenating them.
export interface Traced {
  // Mercator, interleaved x then y
  points: number[];
  // One per point, the line the segment reaching it ran along. The first point's goes unused.
  lines: Array<LineRef|undefined>;
  // One per point, the line it was snapped onto
  on: Array<LineRef|undefined>;
}

export function emptyTrace(): Traced {
  return {points: [], lines: [], on: []};
}

// Appends a point, reached from the trace's last point along line.
export function pushPoint(
    trace: Traced, point: Vec2, line: LineRef|undefined, on: LineRef|undefined): void {
  trace.points.push(point[0], point[1]);
  trace.lines.push(line);
  trace.on.push(on);
}

export function appendTrace(trace: Traced, other: Traced): void {
  // A loop rather than push(...other.points), which passes each value as an argument and so
  // throws on a route of more than about 100k points.
  for (const value of other.points) {
    trace.points.push(value);
  }
  for (let i = 0; i < other.lines.length; ++i) {
    trace.lines.push(other.lines[i]);
    trace.on.push(other.on[i]);
  }
}

/**
 * Appends a route from the trace's last point, or from where the route starts when the trace is
 * empty. A route that starts somewhere else is reached by a straight segment, and one with no via
 * is a straight segment to its end.
 */
export function appendRoute(trace: Traced, route: Route): void {
  const count = trace.points.length / 2;
  const last: Vec2|undefined =
      count > 0 ? [trace.points[2 * count - 2], trace.points[2 * count - 1]] : undefined;
  routeAfter(trace, last, route);
}

/** Returns the points of a route after start, the way appendRoute would add them to a trace. */
export function routeTrace(start: Vec2, route: Route): Traced {
  const trace = emptyTrace();
  routeAfter(trace, start, route);
  return trace;
}

// Appends a route after start, which the trace may or may not hold already.
function routeAfter(trace: Traced, start: Vec2|undefined, route: Route): void {
  const via = route.via;
  if (!start || (via && (start[0] !== route.from[0] || start[1] !== route.from[1]))) {
    pushPoint(trace, route.from, undefined, undefined);
  }

  if (!via) {
    pushPoint(trace, route.to, undefined, route.toLine);
    return;
  }

  // route.lines has one per segment of from, via, to, so the segment reaching via vertex i is i.
  const lines = route.lines ?? [];
  for (let i = 0; i < via.length / 2; ++i) {
    pushPoint(trace, [via[2 * i], via[2 * i + 1]], lines[i], undefined);
  }
  pushPoint(trace, route.to, lines[via.length / 2], route.toLine);
}

export function traceRefs(trace: Traced): LineRef[] {
  const refs = [];
  for (let i = 0; i < trace.lines.length; ++i) {
    const line = trace.lines[i];
    if (line && i > 0) {
      refs.push(line);
    }
    const on = trace.on[i];
    if (on) {
      refs.push(on);
    }
  }
  return refs;
}

// The output of refine, with where each input point landed in it
export interface Refined {
  points: Float64Array;
  // One per input point, the index of the output point it became
  at: Uint32Array;
}

/**
 * Swaps the stretches of a trace that ran along a simplified line for that line's unsimplified
 * geometry, and moves the points snapped onto one onto it. Everything without geometry stays as it
 * is.
 *
 * Where two runs meet at a point that isn't a vertex of both lines, each run places it on its own
 * line, which leaves a jog of up to the snap tolerance between them.
 */
export function refine(
    trace: Traced, geometry: (ref: LineRef) => Float64Array|undefined): Refined {
  const points = trace.points;
  const count = points.length / 2;
  const out: number[] = [];
  const at = new Uint32Array(count);
  const push = (x: number, y: number) => {
    const last = out.length - 2;
    if (last < 0 || out[last] !== x || out[last + 1] !== y) {
      out.push(x, y);
    }
    return out.length / 2 - 1;
  };
  // A point moved onto the line it was snapped onto, if that line has loaded
  const place = (i: number) => {
    const ref = trace.on[i];
    const fine = ref ? geometry(ref) : undefined;
    const [x, y] =
        fine
            ? nearestOn(points[2 * i], points[2 * i + 1], fine)
            : [points[2 * i], points[2 * i + 1]];
    return push(x, y);
  };

  // The line under the segment leaving point i, and its unsimplified geometry if it has loaded
  const lineFrom = (i: number) => i < count - 1 ? trace.lines[i + 1] : undefined;
  const fineFrom = (i: number) => {
    const ref = lineFrom(i);
    return ref ? geometry(ref) : undefined;
  };

  let i = 0;
  // The point the last run ended on, when the run starting there is the next one
  let carried = -1;
  while (i < count) {
    const fine = fineFrom(i);
    if (!fine) {
      at[i] = place(i);
      i += 1;
      continue;
    }

    const ref = lineFrom(i)!;
    let end = i + 1;
    while (end < count - 1 && sameRef(lineFrom(end), ref)) {
      end += 1;
    }

    const run = Float64Array.from(points.slice(2 * i, 2 * end + 2));
    const matched = matchRun(run, fine, push);
    for (let k = i; k <= end; ++k) {
      // A run that can't be placed keeps where the last one put the point they share, or else
      // placing it again could land a little off and draw a backtrack.
      at[k] = matched ? matched[k - i] : k === carried ? at[k] : place(k);
    }
    // The last point starts the next run when there is one, or else it has been placed.
    carried = fineFrom(end) ? end : -1;
    i = fineFrom(end) ? end : end + 1;
  }
  return {points: Float64Array.from(out), at};
}

// A place a run point could sit on the unsimplified line: param is the segment index plus how far
// along it, and cost is how far that is from the point.
interface Candidate {
  param: number;
  cost: number;
}

// Lays a run of points that followed a simplified line along the unsimplified one, pushing the
// output, and returns the output index each run point became. Undefined when the run can't be
// placed in order along it.
//
// Simplification keeps a subset of the vertices, so a run point is usually one of fine's exactly.
// The exceptions are where the run started or stopped partway along a simplified segment, or met
// another line by a join, and those take the nearest place that keeps the run in order.
function matchRun(
    run: Float64Array,
    fine: Float64Array,
    push: (x: number, y: number) => number): number[]|undefined {
  const layers = [];
  for (let i = 0; i < run.length; i += 2) {
    layers.push(candidates(run[i], run[i + 1], fine));
  }

  // The run may have gone either way along the line.
  const forwards = order(layers, 1);
  const backwards = order(layers, -1);
  const best =
      forwards && (!backwards || forwards.cost <= backwards.cost) ? forwards : backwards;
  if (!best) {
    return undefined;
  }

  const params = best.params;
  const vertexCount = fine.length / 2;
  const indices = [push(...positionAt(params[0], fine))];
  for (let l = 1; l < params.length; ++l) {
    const s = params[l - 1];
    const t = params[l];
    if (s < t) {
      for (let k = Math.floor(s) + 1; k < t && k < vertexCount; ++k) {
        push(fine[2 * k], fine[2 * k + 1]);
      }
    } else {
      for (let k = Math.ceil(s) - 1; k > t && k >= 0; --k) {
        push(fine[2 * k], fine[2 * k + 1]);
      }
    }
    indices.push(push(...positionAt(t, fine)));
  }
  return indices;
}

// Where a point could sit on fine: the vertices it equals if any, or else the nearest point of each
// segment.
function candidates(px: number, py: number, fine: Float64Array): Candidate[] {
  const exact = (vertexIndex(fine).get(px)?.get(py) ?? []).map(k => ({param: k, cost: 0}));
  if (exact.length > 0 || fine.length < 4) {
    return exact.length > 0 ? exact : [{param: 0, cost: Math.hypot(fine[0] - px, fine[1] - py)}];
  }

  const segments = [];
  for (let k = 0; k + 3 < fine.length; k += 2) {
    const t = projectOnto(px, py, fine[k], fine[k + 1], fine[k + 2], fine[k + 3]);
    const x = fine[k] + t * (fine[k + 2] - fine[k]);
    const y = fine[k + 1] + t * (fine[k + 3] - fine[k + 1]);
    segments.push({param: k / 2 + t, cost: Math.hypot(x - px, y - py)});
  }
  return segments;
}

// Each line's vertex indices by position, x outermost, built the first time a run is matched
// against it. Matching scans for every run point, and a long line in a reference collection runs to
// 100k vertices. Nested maps rather than a combined key, like PathRouter#index, so that indexing
// doesn't allocate a string per vertex.
const VERTEX_INDICES = new WeakMap<Float64Array, Map<number, Map<number, number[]>>>();

function vertexIndex(fine: Float64Array): Map<number, Map<number, number[]>> {
  const held = VERTEX_INDICES.get(fine);
  if (held) {
    return held;
  }

  const index = new Map<number, Map<number, number[]>>();
  for (let k = 0; k < fine.length; k += 2) {
    let column = index.get(fine[k]);
    if (!column) {
      column = new Map();
      index.set(fine[k], column);
    }
    const at = column.get(fine[k + 1]);
    if (at) {
      at.push(k / 2);
    } else {
      column.set(fine[k + 1], [k / 2]);
    }
  }
  VERTEX_INDICES.set(fine, index);
  return index;
}

// The cheapest choice of one candidate per layer whose params never go backwards, where direction
// 1 is along fine and -1 against it. Each layer's candidates are in ascending param.
function order(layers: Candidate[][], direction: 1|-1): {cost: number; params: number[]}|undefined {
  const along = <T>(values: T[]) => direction > 0 ? values : [...values].reverse();
  let previous = along(layers[0]);
  let costs = previous.map(c => c.cost);
  const choices: number[][] = [];
  for (let l = 1; l < layers.length; ++l) {
    const current = along(layers[l]);
    const next = new Array<number>(current.length);
    const from = new Array<number>(current.length);
    let p = 0;
    let cheapest = Number.POSITIVE_INFINITY;
    let cheapestAt = -1;
    for (let c = 0; c < current.length; ++c) {
      while (p < previous.length && direction * previous[p].param <= direction * current[c].param) {
        if (costs[p] < cheapest) {
          cheapest = costs[p];
          cheapestAt = p;
        }
        p += 1;
      }
      next[c] = cheapest + current[c].cost;
      from[c] = cheapestAt;
    }
    choices.push(from);
    previous = current;
    costs = next;
  }

  let last = -1;
  for (let c = 0; c < costs.length; ++c) {
    if (last < 0 || costs[c] < costs[last]) {
      last = c;
    }
  }
  if (last < 0 || !Number.isFinite(costs[last])) {
    return undefined;
  }

  const params = [];
  let c = last;
  for (let l = layers.length - 1; l >= 0; --l) {
    params.push(along(layers[l])[c].param);
    if (l > 0) {
      c = choices[l - 1][c];
    }
  }
  return {cost: costs[last], params: params.reverse()};
}

function positionAt(param: number, fine: Float64Array): [number, number] {
  const k = Math.min(Math.floor(param), fine.length / 2 - 1);
  const t = param - k;
  if (t === 0) {
    return [fine[2 * k], fine[2 * k + 1]];
  }
  return [
    fine[2 * k] + t * (fine[2 * k + 2] - fine[2 * k]),
    fine[2 * k + 1] + t * (fine[2 * k + 3] - fine[2 * k + 1]),
  ];
}

export function nearestOn(px: number, py: number, fine: Float64Array): [number, number] {
  let best: [number, number] = [fine[0], fine[1]];
  let bestDistance2 = Number.POSITIVE_INFINITY;
  for (let k = 0; k + 3 < fine.length; k += 2) {
    const t = projectOnto(px, py, fine[k], fine[k + 1], fine[k + 2], fine[k + 3]);
    const x = fine[k] + t * (fine[k + 2] - fine[k]);
    const y = fine[k + 1] + t * (fine[k + 3] - fine[k + 1]);
    const d2 = (x - px) * (x - px) + (y - py) * (y - py);
    if (d2 < bestDistance2) {
      best = [x, y];
      bestDistance2 = d2;
    }
  }
  return best;
}

// How far along ab the nearest point to p is, from 0 to 1
function projectOnto(
    px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const length2 = dx * dx + dy * dy;
  return length2 > 0 ? Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / length2)) : 0;
}

function sameRef(a: LineRef|undefined, b: LineRef): boolean {
  return !!a && a.url === b.url && a.id.lsb === b.id.lsb && a.id.msb === b.id.msb;
}
