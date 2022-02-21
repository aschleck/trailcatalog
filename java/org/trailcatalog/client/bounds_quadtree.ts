import { PixelRect, Vec2 } from './support';

export function worldBounds<V>(): BoundsQuadtree<V> {
  return new BoundsQuadtree([0, 0], 0.5);
}

const SPLIT_THRESHOLD = 100;
const MIN_HALF_RADIUS = 1 / Math.pow(2, 15);

export class BoundsQuadtree<V> {
  private readonly values: Array<[V, PixelRect]>;
  private children: [
    BoundsQuadtree<V>,
    BoundsQuadtree<V>,
    BoundsQuadtree<V>,
    BoundsQuadtree<V>,
  ]|undefined;

  constructor(private readonly center: Vec2, private readonly halfRadius: number) {
    this.values = [];
  }

  insert(value: V, bound: PixelRect): void {
    if ((bound.low[0] <= this.center[0] && this.center[0] <= bound.high[0]) ||
        (bound.low[1] <= this.center[1] && this.center[1] <= bound.high[1])) {
      this.values.push([value, bound]);
      return;
    }

    if (this.children) {
      // We know that the bound is fully contained by a child, so we can just test any point.
      const xi = (bound.low[0] <= this.center[0]) as unknown as number;
      const yi = (bound.low[1] <= this.center[1]) as unknown as number;
      const child = this.children[(xi << 1) + yi];
      child.insert(value, bound);
      return;
    }

    if (this.halfRadius > MIN_HALF_RADIUS && this.values.length + 1 >= SPLIT_THRESHOLD) {
      const halfHalfRadius = this.halfRadius / 2;
      this.children = [
          new BoundsQuadtree<V>(
              [this.center[0] + this.halfRadius, this.center[1] + this.halfRadius],
              halfHalfRadius),
          new BoundsQuadtree<V>(
              [this.center[0] + this.halfRadius, this.center[1] - this.halfRadius],
              halfHalfRadius),
          new BoundsQuadtree<V>(
              [this.center[0] - this.halfRadius, this.center[1] + this.halfRadius],
              halfHalfRadius),
          new BoundsQuadtree<V>(
              [this.center[0] - this.halfRadius, this.center[1] - this.halfRadius],
              halfHalfRadius),
      ];

      const items = [...this.values];
      this.values.length = 0;
      for (const [sv, sb] of items) {
        this.insert(sv, sb);
      }
      this.insert(value, bound);
    } else {
      this.values.push([value, bound]);
    }
  }

  query(point: Vec2, radius: number, output: V[]): void {
    for (const [value, bound] of this.values) {
      if (intersectCircleAabb(point, radius, bound)) {
        output.push(value);
      }
    }

    if (this.children) {
      const cx = this.center[0];
      const cy = this.center[1];
      if (point[0] - radius <= cx) {
        if (point[1] - radius <= cy) {
          this.children[3].query(point, radius, output);
        } else {
          this.children[2].query(point, radius, output);
        }
      }

      if (cx < point[0] + radius) {
        if (cy < point[1] + radius) {
          this.children[0].query(point, radius, output);
        } else {
          this.children[1].query(point, radius, output);
        }
      }
    }
  }
}

function intersectAabbAabb(a: PixelRect, b: PixelRect): boolean {
  if (a.low[0] > b.high[0] || b.low[0] > a.high[0]) {
    return false;
  } else if (a.low[1] > b.high[1] || b.low[1] > a.high[1]) {
    return false;
  } else {
    return true;
  }
}

function intersectCircleAabb(point: Vec2, radius: number, b: PixelRect): boolean {
  const bHalfWidth = (b.high[0] - b.low[0]) / 2;
  const bHalfHeight = (b.high[1] - b.low[1]) / 2;

  // Test if they definitely don't overlap
  const bOuterRadius = Math.max(bHalfWidth, bHalfHeight);
  const rejectionRadius = radius + bOuterRadius;
  const dx = (b.low[0] + bHalfWidth) - point[0];
  const dy = (b.low[1] + bHalfHeight) - point[1];
  if (dx * dx + dy * dy > rejectionRadius * rejectionRadius) {
    return false;
  }

  // Test if they definitely do overlap
  const bInnerRadius = Math.min(bHalfWidth, bHalfHeight);
  const acceptanceRadius = radius + bInnerRadius;
  if (dx * dx + dy * dy < acceptanceRadius * acceptanceRadius) {
    return true;
  }

  // Test if the closest point on the circle is in the AABB
  const dz = Math.sqrt(dx * dx + dy * dy);
  const tx = point[0] + radius * dx / dz;
  const ty = point[1] + radius * dy / dz;
  return b.low[0] <= tx && tx <= b.high[0] && b.low[1] <= ty && ty <= b.high[1];
}
