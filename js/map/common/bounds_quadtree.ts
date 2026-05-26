import { Rect, Vec2 } from './types';

const SPLIT_THRESHOLD = 100;
const MIN_HALF_RADIUS = 1 / Math.pow(2, 15);

interface Node<V> {
  centerX: number;
  centerY: number;
  halfRadius: number;
  // Parallel arrays. For value index i:
  //   - values[i] is the value
  //   - bounds[4*i .. 4*i+3] is [lowX, lowY, highX, highY] — kept as a plain number[] so V8
  //     stores it as PACKED_DOUBLE_ELEMENTS, no boxed Numbers and no per-entry tuple object
  //     for GC to walk on the query hot path.
  //   - boundRefs[i] is the original Rect passed to insert(), used only to support
  //     delete-by-Rect-identity. The Rect is already live via the value, so this is a
  //     redundant edge for GC, not an extra object.
  values: V[];
  bounds: number[];
  boundRefs: Rect[];
  children: [Node<V>, Node<V>, Node<V>, Node<V>] | undefined;
  valueCount: number;
}

function makeNode<V>(centerX: number, centerY: number, halfRadius: number): Node<V> {
  return {
    centerX,
    centerY,
    halfRadius,
    values: [],
    bounds: [],
    boundRefs: [],
    children: undefined,
    valueCount: 0,
  };
}

export class BoundsQuadtree<V> {
  private readonly root: Node<V>;

  constructor(center: Vec2, halfRadius: number) {
    this.root = makeNode(center[0], center[1], halfRadius);
  }

  delete(bound: Rect): boolean {
    return _delete(this.root, bound);
  }

  insert(value: V, bound: Rect): void {
    insert(this.root, value, bound, bound.low[0], bound.low[1], bound.high[0], bound.high[1]);
  }

  queryCircle(point: Vec2, radius: number, output: V[]): void {
    queryCircle(this.root, point[0], point[1], radius, output);
  }

  queryRect(rect: Rect, output: V[]): void {
    queryRect(this.root, rect.low[0], rect.low[1], rect.high[0], rect.high[1], output);
  }
}

export class WorldBoundsQuadtree<V> extends BoundsQuadtree<V> {
  constructor() {
    super([0, 0], 1);
  }

  queryCircle(point: Vec2, radius: number, output: V[]): void {
    super.queryCircle(point, radius, output);
    if (point[1] - radius < -1) {
      super.queryCircle([point[0], point[1] + 2], radius, output);
    }
    if (point[1] + radius > 1) {
      super.queryCircle([point[0], point[1] - 2], radius, output);
    }
  }

  queryRect(rect: Rect, output: V[]): void {
    super.queryRect(rect, output);
    if (rect.low[1] < -1) {
      super.queryRect({
        low: [rect.low[0], rect.low[1] + 2],
        high: [rect.high[0], rect.high[1] + 2],
      }, output);
    }
    if (rect.high[1] > 1) {
      super.queryRect({
        low: [rect.low[0], rect.low[1] - 2],
        high: [rect.high[0], rect.high[1] - 2],
      }, output);
    }
  }
}

function findAndRemove<V>(node: Node<V>, bound: Rect): boolean {
  const refs = node.boundRefs;
  for (let i = 0; i < refs.length; ++i) {
    if (refs[i] === bound) {
      node.values.splice(i, 1);
      node.bounds.splice(i * 4, 4);
      refs.splice(i, 1);
      node.valueCount -= 1;
      return true;
    }
  }
  return false;
}

function _delete<V>(node: Node<V>, bound: Rect): boolean {
  if ((bound.low[0] <= node.centerX && node.centerX <= bound.high[0]) ||
      (bound.low[1] <= node.centerY && node.centerY <= bound.high[1])) {
    return findAndRemove(node, bound);
  }

  if (node.children) {
    const xi = (bound.low[0] <= node.centerX) as unknown as number;
    const yi = (bound.low[1] <= node.centerY) as unknown as number;
    const child = node.children[(xi << 1) + yi];
    const deleted = _delete(child, bound);
    if (deleted) {
      node.valueCount -= 1;
    }

    if (node.valueCount < SPLIT_THRESHOLD) {
      collapseChildren(node);
    }

    return deleted;
  } else {
    return findAndRemove(node, bound);
  }
}

function insert<V>(
    node: Node<V>,
    value: V,
    boundRef: Rect,
    lowX: number,
    lowY: number,
    highX: number,
    highY: number): void {
  node.valueCount += 1;

  if ((lowX <= node.centerX && node.centerX <= highX) ||
      (lowY <= node.centerY && node.centerY <= highY)) {
    node.values.push(value);
    node.bounds.push(lowX, lowY, highX, highY);
    node.boundRefs.push(boundRef);
    return;
  }

  if (node.children) {
    const xi = (lowX <= node.centerX) as unknown as number;
    const yi = (lowY <= node.centerY) as unknown as number;
    insert(node.children[(xi << 1) + yi], value, boundRef, lowX, lowY, highX, highY);
    return;
  }

  if (node.halfRadius > MIN_HALF_RADIUS && node.values.length + 1 >= SPLIT_THRESHOLD) {
    const halfHalfRadius = node.halfRadius / 2;
    node.children = [
      makeNode(node.centerX + node.halfRadius, node.centerY + node.halfRadius, halfHalfRadius),
      makeNode(node.centerX + node.halfRadius, node.centerY - node.halfRadius, halfHalfRadius),
      makeNode(node.centerX - node.halfRadius, node.centerY + node.halfRadius, halfHalfRadius),
      makeNode(node.centerX - node.halfRadius, node.centerY - node.halfRadius, halfHalfRadius),
    ];

    const oldValues = node.values;
    const oldBounds = node.bounds;
    const oldBoundRefs = node.boundRefs;
    node.values = [];
    node.bounds = [];
    node.boundRefs = [];
    for (let i = 0; i < oldValues.length; ++i) {
      const j = i * 4;
      insert(
          node,
          oldValues[i],
          oldBoundRefs[i],
          oldBounds[j], oldBounds[j + 1], oldBounds[j + 2], oldBounds[j + 3]);
    }
    insert(node, value, boundRef, lowX, lowY, highX, highY);
  } else {
    node.values.push(value);
    node.bounds.push(lowX, lowY, highX, highY);
    node.boundRefs.push(boundRef);
  }
}

function collapseChildren<V>(node: Node<V>): void {
  const children = node.children;
  if (!children) return;
  for (let c = 0; c < 4; ++c) {
    const child = children[c];
    collapseChildren(child);
    const cvs = child.values;
    for (let i = 0; i < cvs.length; ++i) {
      node.values.push(cvs[i]);
    }
    const cbs = child.bounds;
    for (let i = 0; i < cbs.length; ++i) {
      node.bounds.push(cbs[i]);
    }
    const cbr = child.boundRefs;
    for (let i = 0; i < cbr.length; ++i) {
      node.boundRefs.push(cbr[i]);
    }
  }
  node.children = undefined;
}

function queryCircle<V>(
    node: Node<V>,
    px: number,
    py: number,
    radius: number,
    output: V[]): void {
  const values = node.values;
  const bounds = node.bounds;
  const r2 = radius * radius;
  const count = values.length;
  for (let i = 0; i < count; ++i) {
    const j = i * 4;
    const lowX = bounds[j];
    const lowY = bounds[j + 1];
    const highX = bounds[j + 2];
    const highY = bounds[j + 3];
    if (intersectCircleAabb(px, py, r2, lowX, lowY, highX, highY)) {
      output.push(values[i]);
    }
  }

  const children = node.children;
  if (children) {
    const cx = node.centerX;
    const cy = node.centerY;
    if (px - radius <= cx) {
      if (py - radius <= cy) {
        queryCircle(children[3], px, py, radius, output);
      }
      if (py + radius > cy) {
        queryCircle(children[2], px, py, radius, output);
      }
    }
    if (px + radius > cx) {
      if (py - radius <= cy) {
        queryCircle(children[1], px, py, radius, output);
      }
      if (py + radius > cy) {
        queryCircle(children[0], px, py, radius, output);
      }
    }
  }
}

function queryRect<V>(
    node: Node<V>,
    lowX: number,
    lowY: number,
    highX: number,
    highY: number,
    output: V[]): void {
  const values = node.values;
  const bounds = node.bounds;
  const count = values.length;
  for (let i = 0; i < count; ++i) {
    const j = i * 4;
    const bLowX = bounds[j];
    const bLowY = bounds[j + 1];
    const bHighX = bounds[j + 2];
    const bHighY = bounds[j + 3];
    if (!(lowX > bHighX || bLowX > highX) && !(lowY > bHighY || bLowY > highY)) {
      output.push(values[i]);
    }
  }

  const children = node.children;
  if (children) {
    const cx = node.centerX;
    const cy = node.centerY;
    if (lowX <= cx) {
      if (lowY <= cy) {
        queryRect(children[3], lowX, lowY, highX, highY, output);
      }
      if (highY > cy) {
        queryRect(children[2], lowX, lowY, highX, highY, output);
      }
    }
    if (highX > cx) {
      if (lowY <= cy) {
        queryRect(children[1], lowX, lowY, highX, highY, output);
      }
      if (highY > cy) {
        queryRect(children[0], lowX, lowY, highX, highY, output);
      }
    }
  }
}

function intersectCircleAabb(
    px: number,
    py: number,
    r2: number,
    lowX: number,
    lowY: number,
    highX: number,
    highY: number): boolean {
  if (lowX <= px && px <= highX && lowY <= py && py <= highY) {
    return true;
  }
  const halfWidth = (highX - lowX) / 2;
  const halfHeight = (highY - lowY) / 2;
  const dx = px - (lowX + halfWidth);
  const dy = py - (lowY + halfHeight);
  const cx = dx < -halfWidth ? -halfWidth : (dx > halfWidth ? halfWidth : dx);
  const cy = dy < -halfHeight ? -halfHeight : (dy > halfHeight ? halfHeight : dy);
  const dxPrime = px - (lowX + cx);
  const dyPrime = py - (lowY + cy);
  return dxPrime * dxPrime + dyPrime * dyPrime <= r2;
}
