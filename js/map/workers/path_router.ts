import { checkExists } from 'external/dev_april_corgi+/js/common/asserts';

import { BoundsQuadtree } from '../common/bounds_quadtree';
import { Rect, Vec2 } from '../common/types';

/** An end of a route: a point on the network and the segment it lies on. */
export interface Anchor {
  // Mercator
  point: Vec2;
  // The ends of the segment it lies on, which are nodes of the network
  a: Vec2;
  b: Vec2;
}

// The lines loaded under one group id, and the edges they become once noded. Noding waits for
// prepare or the next route, because it walks a hash map per vertex and a group that arrives while
// nobody is drawing should cost nothing.
interface Group {
  lines: Float64Array[]|undefined;
  // How far these lines may sit from the geometry they stand for, in mercator.
  tolerance: number;
  edges: Int32Array|undefined;
  // The node at each end of each line, which is where a line from another group may meet it
  // without sharing a vertex.
  ends: Int32Array|undefined;
  // What the lines cover, and their runs and ends by bound, in mercator. Each group has its own
  // trees so that joining a group only searches the few groups near it, rather than wading through
  // a tree mostly full of its own lines.
  bound: Rect|undefined;
  runs: Run[];
  runTree: BoundsQuadtree<Run>;
  // Indices into ends
  endTree: BoundsQuadtree<number>;
  // Joins found when this group was noded, onto its segments and from its ends. Whichever group
  // was noded second holds a join, so each is found once and goes when either group does.
  joins: Join[];
}

// Consecutive edges in a group's edges, from start up to end.
interface Run {
  start: number;
  end: number;
  bound: Rect;
}

// An end joined onto the segment from a to b, with partner the group that doesn't hold the join.
interface Join {
  partner: Group;
  end: number;
  a: number;
  b: number;
}

// Room for a tile's vertices, so the first group in doesn't reallocate.
const INITIAL_NODES = 1 << 16;

// How many segments share a bound in a run tree. A whole line is too coarse because a long way's
// bound covers every end inside it and each of those scans all of its segments, and one segment
// apiece puts every vertex on screen in the tree.
const RUN_SEGMENTS = 16;

/**
 * A* over the polylines a layer holds. Two polylines connect where they share a vertex, and where
 * the end of one comes within tolerance of a segment of another group's.
 *
 * The server keeps the vertices a tile's paths share when it simplifies them, but not the ones
 * shared across tiles, so those junctions come from ends alone. Two ways from different tiles that
 * cross with neither ending there don't connect.
 */
export class PathRouter {

  // Node ids by position, x outermost. Nested maps rather than one map on a combined key because
  // a combined key allocates a string per vertex on screen.
  private index: Map<number, Map<number, number>>;
  private x: Float64Array;
  private y: Float64Array;
  private nodeCount: number;
  private readonly groups: Map<string, Group>;
  // Edges of the groups that have been unloaded. Their nodes stay in index because telling which
  // ones a surviving group still uses takes a pass over every edge, so compact waits until dead
  // edges outnumber live ones.
  private deadEdges: number;

  // The ends joined onto each segment, keyed by segmentKey, so that a route starting or ending on
  // that segment can leave or arrive through them instead of doubling back through its nodes.
  private joined: Map<string, number[]>;

  // Every group's edges and joins as CSR, or undefined when a group has come or gone since it was
  // built. The search state is sized to it.
  private adjacency: {offsets: Int32Array; neighbors: Int32Array}|undefined;
  private cost: Float64Array;
  private cameFrom: Int32Array;
  private settled: Uint8Array;

  constructor() {
    this.index = new Map();
    this.x = new Float64Array(INITIAL_NODES);
    this.y = new Float64Array(INITIAL_NODES);
    this.nodeCount = 0;
    this.groups = new Map();
    this.deadEdges = 0;

    this.joined = new Map();
    this.adjacency = undefined;
    this.cost = new Float64Array(0);
    this.cameFrom = new Int32Array(0);
    this.settled = new Uint8Array(0);
  }

  /**
   * Replaces the lines held under a group id. Tolerance is how far they may sit from the geometry
   * they stand for, in mercator.
   */
  load(groupId: string, lines: Float64Array[], tolerance: number): void {
    this.unload(groupId);
    this.groups.set(groupId, {
      lines,
      tolerance,
      edges: undefined,
      ends: undefined,
      bound: undefined,
      runs: [],
      runTree: new BoundsQuadtree([0, 0], 1),
      endTree: new BoundsQuadtree([0, 0], 1),
      joins: [],
    });
    this.adjacency = undefined;
  }

  unload(groupId: string): void {
    const group = this.groups.get(groupId);
    if (!group) {
      return;
    }

    this.groups.delete(groupId);
    if (group.edges) {
      this.deadEdges += group.edges.length / 2;
    }
    for (const other of this.groups.values()) {
      if (other.joins.some(join => join.partner === group)) {
        other.joins = other.joins.filter(join => join.partner !== group);
      }
    }
    this.adjacency = undefined;
  }

  /** Nodes and joins whatever has arrived since the last build, so the next route doesn't. */
  prepare(): void {
    this.buildAdjacency();
  }

  /**
   * The vertices strictly between two anchors, or undefined when the network doesn't join them
   * without straying further than reach from the line between them.
   */
  route(from: Anchor, to: Anchor, reach: number): Float64Array|undefined {
    const {offsets, neighbors} = this.buildAdjacency();
    const fromA = this.nodeAt(from.a);
    const fromB = this.nodeAt(from.b);
    const toA = this.nodeAt(to.a);
    const toB = this.nodeAt(to.b);
    if (fromA < 0 || fromB < 0 || toA < 0 || toB < 0) {
      return undefined;
    }

    // Both ends on one segment, so no vertex lies between them.
    if ((fromA === toA && fromB === toB) || (fromA === toB && fromB === toA)) {
      return new Float64Array(0);
    }

    const nodeCount = this.nodeCount;
    const cost = this.cost;
    const cameFrom = this.cameFrom;
    const settled = this.settled;
    cost.fill(Number.POSITIVE_INFINITY, 0, nodeCount);
    cameFrom.fill(-1, 0, nodeCount);
    settled.fill(0, 0, nodeCount);

    // Bounds the search, which would otherwise flood everything reachable whenever the ends don't
    // connect.
    const reach2 = reach * reach;
    const goals = [toA, toB, ...this.joinedOnto(toA, toB)];
    const heap = new Heap();
    for (const seed of [fromA, fromB, ...this.joinedOnto(fromA, fromB)]) {
      cost[seed] = distance(from.point[0], from.point[1], this.x[seed], this.y[seed]);
      heap.push(cost[seed] + distance(this.x[seed], this.y[seed], to.point[0], to.point[1]), seed);
    }

    while (!heap.isEmpty) {
      const u = heap.pop();
      if (settled[u]) {
        continue;
      }
      settled[u] = 1;

      // A* settles nodes in order of their total cost, so the first node of the goal segment to
      // settle holds the cheapest route to it.
      if (goals.includes(u)) {
        return this.unwind(u, from.point, to.point);
      }

      const ux = this.x[u];
      const uy = this.y[u];
      const end = offsets[u + 1];
      for (let i = offsets[u]; i < end; ++i) {
        const v = neighbors[i];
        if (settled[v]) {
          continue;
        }

        const vx = this.x[v];
        const vy = this.y[v];
        if (distanceToSegment2(vx, vy, from.point[0], from.point[1], to.point[0], to.point[1])
            > reach2) {
          continue;
        }

        const through = cost[u] + distance(ux, uy, vx, vy);
        if (through < cost[v]) {
          cost[v] = through;
          cameFrom[v] = u;
          heap.push(through + distance(vx, vy, to.point[0], to.point[1]), v);
        }
      }
    }
    return undefined;
  }

  // Nodes whatever arrived since the last route and lays every group's edges out as CSR: node i's
  // neighbors are neighbors[offsets[i]] up to offsets[i + 1]. Counting before filling costs a
  // second pass over the edges and saves an array per node.
  //
  // A group that comes or goes only costs the passes over the edges and joins here. Noding and
  // joining run once per group, so panning past a cell does not redo the ones already held.
  private buildAdjacency(): {offsets: Int32Array; neighbors: Int32Array} {
    const held = this.adjacency;
    if (held) {
      return held;
    }

    const arrived = new Set<Group>();
    let liveEdges = 0;
    for (const group of this.groups.values()) {
      if (group.lines) {
        this.node(group, group.lines);
        group.lines = undefined;
        arrived.add(group);
      }
      liveEdges += checkExists(group.edges).length / 2;
    }
    if (this.deadEdges > liveEdges) {
      this.compact();
    }

    let widest = 0;
    for (const group of this.groups.values()) {
      widest = Math.max(widest, group.tolerance);
    }
    for (const group of arrived) {
      this.join(group, arrived, widest);
    }

    this.joined = new Map();
    const joins = [];
    for (const group of this.groups.values()) {
      for (const {end, a, b} of group.joins) {
        joins.push(end, a, end, b);
        const key = segmentKey(a, b);
        const onto = this.joined.get(key);
        if (onto) {
          onto.push(end);
        } else {
          this.joined.set(key, [end]);
        }
      }
    }
    const edgeLists = [...this.groups.values()].map(group => checkExists(group.edges));
    edgeLists.push(Int32Array.from(joins));

    const nodeCount = this.nodeCount;
    const offsets = new Int32Array(nodeCount + 1);
    for (const edges of edgeLists) {
      for (let i = 0; i < edges.length; i += 2) {
        offsets[edges[i] + 1] += 1;
        offsets[edges[i + 1] + 1] += 1;
      }
    }
    for (let i = 0; i < nodeCount; ++i) {
      offsets[i + 1] += offsets[i];
    }

    const neighbors = new Int32Array(offsets[nodeCount]);
    const filled = offsets.slice(0, nodeCount);
    for (const edges of edgeLists) {
      for (let i = 0; i < edges.length; i += 2) {
        const u = edges[i];
        const v = edges[i + 1];
        neighbors[filled[u]] = v;
        filled[u] += 1;
        neighbors[filled[v]] = u;
        filled[v] += 1;
      }
    }

    if (this.cost.length < nodeCount) {
      this.cost = new Float64Array(nodeCount);
      this.cameFrom = new Int32Array(nodeCount);
      this.settled = new Uint8Array(nodeCount);
    }

    this.adjacency = {offsets, neighbors};
    return this.adjacency;
  }

  // Turns a group's lines into edges between node ids, adding the vertices no group has used yet,
  // and puts its runs and ends in the trees.
  private node(group: Group, lines: Float64Array[]): void {
    let segments = 0;
    for (const line of lines) {
      segments += Math.max(0, line.length / 2 - 1);
    }

    const edges = new Int32Array(2 * segments);
    const ends = [];
    let at = 0;
    for (const line of lines) {
      const start = at;
      let previous = -1;
      for (let i = 0; i < line.length; i += 2) {
        const node = this.nodeFor(line[i], line[i + 1]);
        // A repeated point makes a segment with no length.
        if (previous >= 0 && previous !== node) {
          edges[at] = previous;
          edges[at + 1] = node;
          at += 2;
        }
        previous = node;
      }

      if (at === start) {
        continue;
      }
      for (let run = start; run < at; run += 2 * RUN_SEGMENTS) {
        const end = Math.min(at, run + 2 * RUN_SEGMENTS);
        const bound = this.runBound(edges, run, end);
        group.runs.push({start: run, end, bound});
        group.runTree.insert(group.runs[group.runs.length - 1], bound);
        group.bound = group.bound ? union(group.bound, bound) : bound;
      }
      for (const end of [edges[start], edges[at - 1]]) {
        const point = [this.x[end], this.y[end]] as const;
        group.endTree.insert(ends.length, {low: point, high: point});
        ends.push(end);
      }
    }
    group.edges = edges.subarray(0, at);
    group.ends = Int32Array.from(ends);
  }

  // Joins a newly noded group's ends onto the nearest segment of each nearby group's runs within
  // tolerance, and the ends of nearby groups already held onto its runs. The groups that arrived
  // with it join its runs from their own side.
  //
  // The tolerance is whichever group's is larger rather than their sum, because only one side
  // ever moves: simplification keeps a line's ends, and rounding to E7 is all that moves the end
  // of a drawn line.
  //
  // Lines in the same group are left alone because the server keeps the vertices a tile shares.
  // Drawn lines are each their own group, so they still join each other.
  private join(group: Group, arrived: Set<Group>, widest: number): void {
    const bound = group.bound;
    if (!bound) {
      return;
    }

    const ends = checkExists(group.ends);
    const runs: Run[] = [];
    const indices: number[] = [];
    for (const other of this.groups.values()) {
      const reach = other.bound ? expand(other.bound, widest) : undefined;
      if (other === group || !reach || !intersect(reach, bound)) {
        continue;
      }

      for (const end of ends) {
        const x = this.x[end];
        const y = this.y[end];
        // Most of a tile's ends are nowhere near its neighbors.
        if (x < reach.low[0] || reach.high[0] < x || y < reach.low[1] || reach.high[1] < y) {
          continue;
        }

        runs.length = 0;
        other.runTree.queryCircle([x, y], widest, runs);
        for (const run of runs) {
          const join = this.nearestJoin(group, end, other, run);
          if (join) {
            group.joins.push({partner: other, ...join});
          }
        }
      }

      if (arrived.has(other)) {
        continue;
      }
      const otherEnds = checkExists(other.ends);
      for (const run of group.runs) {
        indices.length = 0;
        other.endTree.queryRect(expand(run.bound, widest), indices);
        for (const i of indices) {
          const join = this.nearestJoin(other, otherEnds[i], group, run);
          if (join) {
            group.joins.push({partner: other, ...join});
          }
        }
      }
    }
  }

  // The nearest segment of a run to one end, if it is within tolerance and doesn't already share
  // the end as a vertex.
  private nearestJoin(endGroup: Group, end: number, runGroup: Group, run: Run):
      {end: number; a: number; b: number}|undefined {
    const tolerance = Math.max(endGroup.tolerance, runGroup.tolerance);
    const edges = checkExists(runGroup.edges);
    const px = this.x[end];
    const py = this.y[end];
    let best = tolerance * tolerance;
    let bestAt = -1;
    for (let i = run.start; i < run.end; i += 2) {
      const d2 =
          distanceToSegment2(
              px,
              py,
              this.x[edges[i]],
              this.y[edges[i]],
              this.x[edges[i + 1]],
              this.y[edges[i + 1]]);
      if (d2 <= best) {
        best = d2;
        bestAt = i;
      }
    }

    if (bestAt < 0) {
      return undefined;
    }
    const a = edges[bestAt];
    const b = edges[bestAt + 1];
    return a === end || b === end ? undefined : {end, a, b};
  }

  private runBound(edges: Int32Array, start: number, end: number): Rect {
    let lowX = Number.POSITIVE_INFINITY;
    let lowY = Number.POSITIVE_INFINITY;
    let highX = Number.NEGATIVE_INFINITY;
    let highY = Number.NEGATIVE_INFINITY;
    for (let i = start; i < end; ++i) {
      const x = this.x[edges[i]];
      const y = this.y[edges[i]];
      lowX = Math.min(lowX, x);
      lowY = Math.min(lowY, y);
      highX = Math.max(highX, x);
      highY = Math.max(highY, y);
    }
    return {low: [lowX, lowY], high: [highX, highY]};
  }

  private nodeFor(px: number, py: number): number {
    let column = this.index.get(px);
    if (!column) {
      column = new Map();
      this.index.set(px, column);
    }

    const held = column.get(py);
    if (held !== undefined) {
      return held;
    }

    const node = this.nodeCount;
    this.nodeCount += 1;
    if (node === this.x.length) {
      this.x = grow(this.x);
      this.y = grow(this.y);
    }
    column.set(py, node);
    this.x[node] = px;
    this.y[node] = py;
    return node;
  }

  // Renumbers the nodes the surviving groups reach and drops the rest, which unloading leaves
  // behind.
  private compact(): void {
    const remap = new Int32Array(this.nodeCount).fill(-1);
    const x = new Float64Array(this.x.length);
    const y = new Float64Array(this.y.length);
    let count = 0;
    for (const group of this.groups.values()) {
      const edges = checkExists(group.edges);
      for (let i = 0; i < edges.length; ++i) {
        const was = edges[i];
        let node = remap[was];
        if (node < 0) {
          node = count;
          count += 1;
          remap[was] = node;
          x[node] = this.x[was];
          y[node] = this.y[was];
        }
        edges[i] = node;
      }

      // Every end and every join is on an edge, so the pass above has already renumbered them.
      const ends = checkExists(group.ends);
      for (let i = 0; i < ends.length; ++i) {
        ends[i] = remap[ends[i]];
      }
      for (const join of group.joins) {
        join.end = remap[join.end];
        join.a = remap[join.a];
        join.b = remap[join.b];
      }
    }

    const index = new Map<number, Map<number, number>>();
    for (let node = 0; node < count; ++node) {
      let column = index.get(x[node]);
      if (!column) {
        column = new Map();
        index.set(x[node], column);
      }
      column.set(y[node], node);
    }

    this.index = index;
    this.x = x;
    this.y = y;
    this.nodeCount = count;
    this.deadEdges = 0;
  }

  private joinedOnto(a: number, b: number): number[] {
    return this.joined.get(segmentKey(a, b)) ?? [];
  }

  // Walks back from the goal to the seed that reached it and writes the positions out forwards. An
  // end that repeats its anchor is dropped, which happens when the anchor sits on a vertex.
  private unwind(goal: number, from: Vec2, to: Vec2): Float64Array {
    const backwards = [];
    for (let node = goal; node >= 0; node = this.cameFrom[node]) {
      backwards.push(node);
    }

    let first = backwards.length - 1;
    if (this.x[backwards[first]] === from[0] && this.y[backwards[first]] === from[1]) {
      first -= 1;
    }
    let last = 0;
    if (this.x[backwards[last]] === to[0] && this.y[backwards[last]] === to[1]) {
      last += 1;
    }

    const via = new Float64Array(2 * Math.max(0, first - last + 1));
    let at = 0;
    for (let i = first; i >= last; --i) {
      via[at] = this.x[backwards[i]];
      via[at + 1] = this.y[backwards[i]];
      at += 2;
    }
    return via;
  }

  // The node at a position, or -1 when there is none. The querier anchors onto the lines this
  // holds, so that only happens to the ends of a zero length segment once compact has run.
  private nodeAt(point: Vec2): number {
    return this.index.get(point[0])?.get(point[1]) ?? -1;
  }
}

// A binary min heap over (priority, value) pairs. Lowering a node's cost pushes a second entry
// rather than moving the first, so a node can hold several entries and the search skips the stale
// ones as they come off.
class Heap {

  private readonly priorities: number[];
  private readonly values: number[];

  constructor() {
    this.priorities = [];
    this.values = [];
  }

  get isEmpty(): boolean {
    return this.values.length === 0;
  }

  push(priority: number, value: number): void {
    let at = this.values.length;
    this.priorities.push(priority);
    this.values.push(value);
    while (at > 0) {
      const parent = (at - 1) >> 1;
      if (this.priorities[parent] <= priority) {
        break;
      }

      this.priorities[at] = this.priorities[parent];
      this.values[at] = this.values[parent];
      at = parent;
    }
    this.priorities[at] = priority;
    this.values[at] = value;
  }

  pop(): number {
    const top = this.values[0];
    const priority = checkExists(this.priorities.pop());
    const value = checkExists(this.values.pop());
    const count = this.values.length;
    if (count === 0) {
      return top;
    }

    let at = 0;
    for (;;) {
      const left = 2 * at + 1;
      if (left >= count) {
        break;
      }

      const right = left + 1;
      const child =
          right < count && this.priorities[right] < this.priorities[left] ? right : left;
      if (priority <= this.priorities[child]) {
        break;
      }

      this.priorities[at] = this.priorities[child];
      this.values[at] = this.values[child];
      at = child;
    }
    this.priorities[at] = priority;
    this.values[at] = value;
    return top;
  }
}

function grow(values: Float64Array): Float64Array {
  const grown = new Float64Array(2 * values.length);
  grown.set(values);
  return grown;
}

function expand(rect: Rect, by: number): Rect {
  return {
    low: [rect.low[0] - by, rect.low[1] - by],
    high: [rect.high[0] + by, rect.high[1] + by],
  };
}

function intersect(a: Rect, b: Rect): boolean {
  return a.low[0] <= b.high[0] && b.low[0] <= a.high[0]
      && a.low[1] <= b.high[1] && b.low[1] <= a.high[1];
}

function union(a: Rect, b: Rect): Rect {
  return {
    low: [Math.min(a.low[0], b.low[0]), Math.min(a.low[1], b.low[1])],
    high: [Math.max(a.high[0], b.high[0]), Math.max(a.high[1], b.high[1])],
  };
}

function segmentKey(a: number, b: number): string {
  return a < b ? `${a},${b}` : `${b},${a}`;
}

function distanceToSegment2(
    px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const length2 = dx * dx + dy * dy;
  const t = length2 > 0 ? Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / length2)) : 0;
  const cx = ax + t * dx - px;
  const cy = ay + t * dy - py;
  return cx * cx + cy * cy;
}

// Mercator rather than on the ground. Mercator stretches by 1/cos(latitude), which is the same
// factor across a route that fits on screen, so the shortest route is the same one.
function distance(ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  return Math.sqrt(dx * dx + dy * dy);
}
