import * as arrays from 'external/dev_april_corgi~/js/common/arrays';

import { Rect, Vec2 } from './types';

const SPLIT_THRESHOLD = 100;
const MIN_HALF_RADIUS = 1 / Math.pow(2, 15);

interface Node<V> {
  center: Vec2;
  halfRadius: number;
  values: Array<[V, Rect]>;
  children: [
    Node<V>,
    Node<V>,
    Node<V>,
    Node<V>,
  ]|undefined;
  valueCount: number;
}

export class BoundsQuadtree<V> {
  private readonly root: Node<V>;

  constructor(center: Vec2, halfRadius: number) {
    this.root = {
      center,
      halfRadius,
      values: [],
      children: undefined,
      valueCount: 0,
    };
  }

  delete(bound: Rect): boolean {
    return _delete(this.root, bound);
  }

  insert(value: V, bound: Rect): void {
    insert(this.root, value, bound);
  }

  queryCircle(point: Vec2, radius: number, output: V[]): void {
    queryCircle(this.root, point, radius, output);
  }

  queryRect(rect: Rect, output: V[]): void {
    queryRect(this.root, rect, output);
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

function _delete<V>(node: Node<V>, bound: Rect): boolean {
  if ((bound.low[0] <= node.center[0] && node.center[0] <= bound.high[0]) ||
      (bound.low[1] <= node.center[1] && node.center[1] <= bound.high[1])) {
    for (let i = 0; i < node.values.length; ++i) {
      if (node.values[i][1] === bound) {
        node.values.splice(i, 1);
        node.valueCount -= 1;
        return true;
      }
    }
    return false;
  }

  if (node.children) {
    // We know that the bound is fully contained by a child, so we can just test any point.
    const xi = (bound.low[0] <= node.center[0]) as unknown as number;
    const yi = (bound.low[1] <= node.center[1]) as unknown as number;
    const child = node.children[(xi << 1) + yi];
    const deleted = _delete(child, bound);
    if (deleted) {
      node.valueCount -= 1;
    }

    if (node.valueCount < SPLIT_THRESHOLD) {
      pushAllValuesInto(node, node.values);
      node.children = undefined;
    }

    return deleted;
  } else {
    for (let i = 0; i < node.values.length; ++i) {
      if (node.values[i][1] === bound) {
        node.values.splice(i, 1);
        node.valueCount -= 1;
        return true;
      }
    }
    return false;
  }
}

function insert<V>(node: Node<V>, value: V, bound: Rect): void {
  node.valueCount += 1;

  if ((bound.low[0] <= node.center[0] && node.center[0] <= bound.high[0]) ||
      (bound.low[1] <= node.center[1] && node.center[1] <= bound.high[1])) {
    node.values.push([value, bound]);
    return;
  }

  if (node.children) {
    // We know that the bound is fully contained by a child, so we can just test any point.
    const xi = (bound.low[0] <= node.center[0]) as unknown as number;
    const yi = (bound.low[1] <= node.center[1]) as unknown as number;
    const child = node.children[(xi << 1) + yi];
    insert(child, value, bound);
    return;
  }

  if (node.halfRadius > MIN_HALF_RADIUS && node.values.length + 1 >= SPLIT_THRESHOLD) {
    const halfHalfRadius = node.halfRadius / 2;
    node.children = [
      {
        center: [node.center[0] + node.halfRadius, node.center[1] + node.halfRadius],
        halfRadius: halfHalfRadius,
        values: [],
        children: undefined,
        valueCount: 0,
      },
      {
        center: [node.center[0] + node.halfRadius, node.center[1] - node.halfRadius],
        halfRadius: halfHalfRadius,
        values: [],
        children: undefined,
        valueCount: 0,
      },
      {
        center: [node.center[0] - node.halfRadius, node.center[1] + node.halfRadius],
        halfRadius: halfHalfRadius,
        values: [],
        children: undefined,
        valueCount: 0,
      },
      {
        center: [node.center[0] - node.halfRadius, node.center[1] - node.halfRadius],
        halfRadius: halfHalfRadius,
        values: [],
        children: undefined,
        valueCount: 0,
      },
    ];

    const items = [...node.values];
    node.values.length = 0;
    for (const [sv, sb] of items) {
      insert(node, sv, sb);
    }
    insert(node, value, bound);
  } else {
    node.values.push([value, bound]);
  }
}

function queryCircle<V>(node: Node<V>, point: Vec2, radius: number, output: V[]): void {
  for (const [value, bound] of node.values) {
    if (intersectCircleAabb(point, radius, bound)) {
      output.push(value);
    }
  }

  if (node.children) {
    const cx = node.center[0];
    const cy = node.center[1];
    if (point[0] - radius <= cx) {
      if (point[1] - radius <= cy) {
        queryCircle(node.children[3], point, radius, output);
      }
      if (point[1] + radius > cy) {
        queryCircle(node.children[2], point, radius, output);
      }
    }
    if (point[0] + radius > cx) {
      if (point[1] - radius <= cy) {
        queryCircle(node.children[1], point, radius, output);
      }
      if (point[1] + radius > cy) {
        queryCircle(node.children[0], point, radius, output);
      }
    }
  }
}

function queryRect<V>(node: Node<V>, rect: Rect, output: V[]): void {
  for (const [value, bound] of node.values) {
    if (intersectAabbAabb(rect, bound)) {
      output.push(value);
    }
  }

  if (node.children) {
    const cx = node.center[0];
    const cy = node.center[1];
    if (rect.low[0] <= cx) {
      if (rect.low[1] <= cy) {
        queryRect(node.children[3], rect, output);
      }
      if (rect.high[1] > cy) {
        queryRect(node.children[2], rect, output);
      }
    }
    if (rect.high[0] > cx) {
      if (rect.low[1] <= cy) {
        queryRect(node.children[1], rect, output);
      }
      if (rect.high[1] > cy) {
        queryRect(node.children[0], rect, output);
      }
    }
  }
}

function pushAllValuesInto<V>(node: Node<V>, output: Array<[V, Rect]>): void {
  arrays.pushInto(output, node.values);
  if (node.children) {
    pushAllValuesInto(node.children[0], output);
    pushAllValuesInto(node.children[1], output);
    pushAllValuesInto(node.children[2], output);
    pushAllValuesInto(node.children[3], output);
  }
}

function intersectAabbAabb(a: Rect, b: Rect): boolean {
  if (a.low[0] > b.high[0] || b.low[0] > a.high[0]) {
    return false;
  } else if (a.low[1] > b.high[1] || b.low[1] > a.high[1]) {
    return false;
  } else {
    return true;
  }
}

function intersectCircleAabb(point: Vec2, radius: number, b: Rect): boolean {
  // Is the circle inside the rectangle?
  if (b.low[0] <= point[0] && point[0] <= b.high[0]
     && b.low[1] <= point[1] && point[1] <= b.high[1]) {
    return true;
  }
  // Find the center of the rectangle
  const halfWidth = (b.high[0] - b.low[0]) / 2;
  const halfHeight = (b.high[1] - b.low[1]) / 2;
  // Find the vector to the circle
  const dx = point[0] - (b.low[0] + halfWidth);
  const dy = point[1] - (b.low[1] + halfHeight);
  // Find the closest point to the circle
  const cx = clamp(-halfWidth, dx, halfWidth);
  const cy = clamp(-halfHeight, dy, halfHeight);
  // Check if that closest point lies inside the circle
  const dxPrime = point[0] - (b.low[0] + cx);
  const dyPrime = point[1] - (b.low[1] + cy);
  return dxPrime * dxPrime + dyPrime * dyPrime <= radius * radius;
}

function clamp(low: number, v: number, high: number): number {
  return Math.min(Math.max(low, v), high);
}

